require('dotenv').load();
var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    redis = require('redis'),
    querystring = require('querystring'),
    request = require('request');


var client = redis.createClient(process.env.REDISCLOUD_URL, {no_read_check: true});

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

var port = process.env.PORT || 8087;
var url = process.env.URL || 'https://hooks.slack.com/services/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';

var router = express.Router();
router.route('/slack')
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

        // Key for an existing prompt.
        // Uses a setex so that it disappears
        var promptKey = "prompt:"+teamId+":"+channelId;
        // Key for most recent prompt
        var currPromptKey = "currentPrompt:":+teamId+":"+channelId;
        if(client.exists(promptKey) {

        }
    });

router.use(function(req, res, next) {
    next();
});

app.use('/api', router);

app.listen(port);
