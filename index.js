require('dotenv').load();
var express = require('express'),
    app = express(),
    fs = require('fs'),
    bodyParser = require('body-parser'),
    redis = require('redis'),
    request = require('request');


var client = redis.createClient(process.env.REDISCLOUD_URL, {no_read_check: true});
var prompts = JSON.parse(fs.readFileSync('./prompts.json','utf8'));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

var port = process.env.PORT || 8087;
var expireTime = process.env.SECONDS_TO_ANSWER || 40;
var botUsername = process.env.BOT_USERNAME || "typeracer";
var slackURL = process.env.INCOMING_WEBHOOK_URL;
var webhookToken = process.env.OUTGOING_WEBHOOK_TOKEN;

console.log("expireTime: " + expireTime + " | slackURL: " + slackURL + " | token: " + webhookToken);

// Initializing Defaults
var promptKey = "prompt:";
var timeKey = "prompt:start:";
var currScores = {};


/*-------------- Routing/API stuff --------------*/
var router = express.Router();
router.route('/')
    .post(function(req, res) {
        var body = req.body;
        var token = body.token;
        var teamId = body.team_id;
        var channelId = body.channel_id;
        var message = body.text;
        var trigger = body.trigger_word;
        var username = body.user_name;
        var timestamp = body.timestamp;

        if(token !== webhookToken) {
            res.send(formatResponse("Invalid token"));
            return;
        }

        var command = message.substring(message.indexOf(trigger)+trigger.length);
        command = command.trim();
        console.log("COMMAND: ["+ command+"]");

        var keySignature = teamId+":"+channelId;

        // Key for an existing prompt.
        // Uses a setex so that it disappears
        var text = "";
        client.exists(promptKey+keySignature, function(err, playing) {
            console.log("PLAYING: ", playing, promptKey+keySignature);
            if(command.indexOf("show scores") === 0) {
                var index = command.replace(/show scores/g, "");
                index = index.trim();
                showScores(index, res);
            } else if(command.indexOf("help") === 0) {
                res.send(formatResponse("start race | show scores [question #]"));
            } else if(playing) {
                text = matchAnswer(username, keySignature, command, res);
            } else if(command.indexOf("start race") === 0) {
                text = getPrompt(keySignature, res);
            } else {
                res.send(formatResponse("I have no idea what you're saying, "+username));
            }
        });
       
        
    });

router.use(function(req, res, next) {
    next();
});

app.use('', router);

app.listen(port);




/*---------- Below this line are all the supporting functions ------------*/

// Check if an answer is correct or not
function matchAnswer(username, keySignature, answer, res) {
    client.get(promptKey+keySignature, function(err, index) {
        var prompt = prompts[index];
        var currTime = new Date();
        console.log("PROMPT: ", prompt);
        console.log("ANSWER1: ["+answer.trim()+"]");
        console.log("ANSWER2: ["+prompt["answer"]+"]");
        if(answer.trim() === prompt["answer"]) {
            client.get(timeKey+keySignature, function(err, startTime) {
                var elapsedTime = (currTime.getTime() - startTime)/1000;
                response = "Nice work "+username+"! That took " + elapsedTime + "seconds. ";
                setUserScore(index, username, elapsedTime);
                updateCurrentScore(username,elapsedTime, keySignature);
                res.send(formatResponse(response));
            });
        } else {
            var response = "Sorry " + username+". You should really brush up on your typing skills. Or is it your reading skills?";
            res.send(formatResponse(response));
        }
    });
}

function updateCurrentScore(username, elapsedTime, keySignature) {
    currScores[keySignature] += (username + " - " + elapsedTime + "\n");
}

// Check to see if a user has a new high score for a particular question
function setUserScore(index, username, elapsedTime) {
    var scoreKey = "score:"+index+":"+username;
    console.log("SCORE KEY: ", scoreKey);
    client.exists(scoreKey, function(err, exists) {
        console.log("SCORE EXISTS?", exists);
        if(exists) {
            client.get(scoreKey, function(err, score) {
                console.log("PREVIOUS SCORE: ", score);
                if(score > elapsedTime) {
                    client.set(scoreKey, elapsedTime);
                }
            });
        } else {
            client.set(scoreKey, elapsedTime);
        }
    });
}

// Show the scores of a certain question
function showScores(index, res) {
    var index = index-1;
    var scoreKey = "score:"+index+":*";
    console.log("SHOW SCORES: ", scoreKey);
    client.scan('0', 'MATCH',scoreKey, 'COUNT', '5', function(err, result) {
        console.log("SCORE RESULTS: ", result);
        var scores = [];
        var scoreKeys = result[1];

        // TODO
        // This next part is kind of ugly. Currently using a closure to lock the value into place so that
        // I can sync multiple async calls. There should be a better way to do this...
        var count = scoreKeys.length;
        var remaining = count;
        if(count === 0) {
            res.send(formatResponse("There are no scores for this question yet!"));
        }
        for(var c=0; c<count; c++) {
            var key = scoreKeys[c];
            (function(key) {
                client.get(key, function(err, score) {
                    var user = key.replace(/score:\d+:/g,'');
                    scores.push({username: user, score: score});
                    remaining--;
                    if(remaining === 0) {
                        scores.sort(function(a,b) {
                            return a.score-b.score;
                        });
                        var response = "Question " + (index+1) + " Scores: \n";
                        for(var s=0; s<scores.length; s++) {
                            response += scores[s].username + " - " + scores[s].score + "\n";
                        }
                        res.send(formatResponse(response));
                    }
                });
            })(key);
        }
    });
}

// Get a new prompt to be sent back to the Slack Server
// Will recursively call itself to get a new prompt if the prompt selected has been used within the last hour
// This is to work around the fact that Slack will not reshow an image that has been shown within the last hour
function getPrompt(keySignature, res, retry) {
    var index = Math.floor(Math.random()*prompts.length);
    var prompt = prompts[index];
    if(!retry) {
        retry = 1;
    } else {
        retry++;
    }
    client.exists("prompt"+prompt["id"]+":nouse", function(err, usedPrompt) {
        if(retry > 200) {
            res.send(formatResponse("Sorry I could not find any new prompts to use"));
        } else if(usedPrompt) {
            getPrompt(keySignature, res,retry);
        } else {
            var currTime = new Date();
            client.setex("prompt"+prompt["id"]+":nouse", 3600, true);
            client.setex(promptKey+keySignature, expireTime+1, index);
            client.set(timeKey+keySignature, currTime.getTime());
            currScores[keySignature] = "The race is over!\n[Top Scores]\n";
            setTimeout(function() {
                sendResults(keySignature);
            }, expireTime*1000);
            var text = "[Question " + (index+1)+"] Let the race begin! " + prompt["link"];
            res.send(formatResponse(text));
        }
    });
}

function sendResults(keySignature) {
    client.del(promptKey+keySignature);
    var payload = {
        text: currScores[keySignature]
    };
    request.post(slackURL, {
        form: {
                  payload: JSON.stringify(payload)
              }
    }, function(err, response) {
        if(err) {
            console.log("REQUEST ERROR: ", err);
        }
    });
}

// Function to format the response sent back to the Slack server
function formatResponse(message) {
    var response = {text: message, link_names: 1};
    response["username"] = botUsername;
    return JSON.stringify(response);
}
