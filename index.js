require('dotenv').load();
var express = require('express'),
    app = express(),
    fs = require('fs'),
    bodyParser = require('body-parser'),
    redis = require('redis'),
    querystring = require('querystring'),
    request = require('request');


var client = redis.createClient(process.env.REDISCLOUD_URL, {no_read_check: true});
var prompts = JSON.parse(fs.readFileSync('./prompts.json','utf8'));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

var port = process.env.PORT || 8087;
var expireTime = process.env.SECONDS_TO_ANSWER || 40;
var botUsername = process.env.BOT_USERNAME || "tr";

var router = express.Router();
router.route('/')
    .post(function(req, res) {
        var body = req.body;
        var teamId = body.team_id;
        var teamName = body.team_domain;
        var channelId = body.channel_id;
        var channelName = body.channel_name;
        var message = body.text;
        var trigger = body.trigger_word;
        var username = body.user_name;
        var timestamp = body.timestamp;

        var slackId = "slack_"+teamId+"_"+channelId;
        var command = message.substring(message.indexOf(trigger)+trigger.length);
        command = command.trim();

        var promptKey = "prompt:"+teamId+":"+channelId;
        var trailKey = teamId+":"+channelId;

        // Key for an existing prompt.
        // Uses a setex so that it disappears
        var text = "";
        client.exists(promptKey, function(playing) {
            if(playing) {
                var key = client.get(promptKey);
                text = matchAnswer(username, trailKey, command, key);
            } else if(command.indexOf("start race") === 0) {
                text = getPrompt(promptKey);
            } else if(command.indexOf("show scores") === 0) {
            } else if(command.indexOf("help") === 0) {
            } else {
            }
            var response = formatResponse(text);
            res.send(response);
        });
       
        
    });

router.use(function(req, res, next) {
    next();
});

app.use('', router);

app.listen(port);
console.log("TYPERACER HAS BEGUN!");

function matchAnswer(username, trailKey, answer, index) {
    var prompt = prompts[index];
    var userKey = username+":"+index+":score";
    var timeKey = "prompt:start:"+trailKey;
    var currTime = new Date();
    var response = "Sorry " + username+". You should really brush up on your typing skills. Or is it your reading skills? Who knows..";
    if(answer.trim() === prompt["answer"]) {
        var startTime = client.get(timeKey);
        var elapsedTime = (currTime.getTime() - startTime)/1000;
        response = "Nice work "+username+"! That took " + elapsedTime + "seconds. ";
        // Set the newest high score
        if(!client.exists(userKey)) {
            client.set(userKey,elapsedTime);
        } else {
            var score = client.get(userKey);
            if(score > elapsedTime) {
                client.set(userKey, elapsedTime);
                response += "That's a new personal best for you!";
            }
        }

    }

    return response;
}


function getPrompt(promptKey) {
    var prompt = prompts[Math.floor(Math.random()*prompts.length)];
    var numRetry = 0;
    while(client.exists("prompt"+prompt["id"]+":nouse")) {
        prompt = prompts[Math.floor(Math.random()*prompts.length)];
        numRetry++;
        if(numRetry > 200) {
            return "Sorry I could not find any new prompts to use";
        }
    }

    client.setex("prompt"+prompt["id"]+":nouse", 3605, true);
    client.setex(promptKey, expireTime, prompt["answer"]);

    return "Let the race begin! " + prompt["link"];
}

function formatResponse(message) {
    var response = {text: message, link_names: 1};
    response["username"] = botUsername;
    return JSON.stringify(response);
}
