var app = require('http').createServer(handler),
	io = require('socket.io').listen(app),
	fs = require('fs'),
	url = require('url'),
	mongoose = require('mongoose'),
	redis = require('redis');

var messageSchema = new mongoose.Schema({
  user: { type: String }
, msg: {type: String}
});

// Compile a 'Movie' model using the movieSchema as the structure.
// Mongoose also creates a MongoDB collection called 'Movies' for these documents.
var Message = mongoose.model('Message', messageSchema);

app.listen(80);

var db = mongoose.connection;
db.on('error', console.error);
db.once('open', function() {

});
mongoose.connect('mongodb://' + process.env.MONGOIP + ':' + process.env.MONGOPORT + '/test');

//var serverMDB = new mongodb.Server(process.env.MONGOIP, process.env.MONGOPORT);
//var clientMDB = new mongodb.Db('test', serverMDB);

function handler(req, res) {
	function readFile(file, res){
	  fs.readFile(__dirname + '/' + file,
	  function (err, data) {
	    if (err) {
	      res.writeHead(500);
	      return res.end('Error loading index.html' + __dirname);
	    }

	    res.writeHead(200);
	    res.end(data);
	  });
	}
	var uri = url.parse(req.url).pathname;
	if(uri == "/"){
		readFile("index.html", res);
	}else if(uri == "/listen"){
		readFile("/listen.html", res);
	}else if(uri == "/all"){
		Message.find(function(err, message) {
		if (err) return console.error(err);
		res.end(JSON.stringify(message));
		});
	}
}

io.configure( function() {
	io.set('close timeout', 60*60*24); // 24h time out
});

function SessionController (user) {
	// session controller class for storing redis connections
	// this is more a workaround for the proof-of-concept
	// in "real" applications session handling should NOT
	// be done like this
	this.sub = redis.createClient(process.env.REDISPORT, process.env.REDISIP);
	this.pub = redis.createClient(process.env.REDISPORT, process.env.REDISIP);
	
	this.user = user;
}

SessionController.prototype.subscribe = function(socket) {
	this.sub.on('message', function(channel, message) {
		socket.emit(channel, message);
	});
	var current = this;
	this.sub.on('subscribe', function(channel, count) {
		var joinMessage = JSON.stringify({action: 'control', user: current.user, msg: ' joined the channel' });
		current.publish(joinMessage);
	});
	this.sub.subscribe('chat');
};

SessionController.prototype.rejoin = function(socket, message) {
	this.sub.on('message', function(channel, message) {
		socket.emit(channel, message);
	});
	var current = this;
	this.sub.on('subscribe', function(channel, count) {
		/*var rejoin = JSON.stringify({action: 'control', user: current.user, msg: ' rejoined the channel' });
		current.publish(rejoin);*/
		var reply = JSON.stringify({action: 'message', user: message.user, msg: message.msg });
		current.publish(reply);
	});
	this.sub.subscribe('chat');
};

SessionController.prototype.unsubscribe = function() {
	this.sub.unsubscribe('chat');
};

SessionController.prototype.publish = function(message) {
	this.pub.publish('chat', message);
};

SessionController.prototype.destroyRedis = function() {
	if (this.sub !== null) this.sub.quit();
	if (this.pub !== null) this.pub.quit();
};

io.sockets.on('connection', function (socket) { // the actual socket callback
	console.log(socket.id);
	socket.on('chat', function (data) { // receiving chat messages
		var msg = JSON.parse(data);
		socket.get('sessionController', function(err, sessionController) {
			if (sessionController === null) {
				// implicit login - socket can be timed out or disconnected
				var newSessionController = new SessionController(msg.user);
				socket.set('sessionController', newSessionController);
				newSessionController.rejoin(socket, msg);
			} else {
				var messageData = {action: 'message', user: msg.user, msg: msg.msg};
				var reply = JSON.stringify(messageData);
				sessionController.publish(reply);
				var iMesg = new Message(messageData);
				iMesg.save(function(err, iMesg) {
				  if (err) return console.error(err);
				  console.dir(iMesg);
				});
				/*clientMDB.collection('messages', function(err, collection) {
					collection.save(messageData);
				});*/
			}
		});
		// just some logging to trace the chat data
		console.log(data);
	});

	socket.on('join', function(data) {
		var msg = JSON.parse(data);
		var sessionController = new SessionController(msg.user);
		socket.set('sessionController', sessionController);
		sessionController.subscribe(socket);
		// just some logging to trace the chat data
		console.log(data);
	});

	socket.on('disconnect', function() { // disconnect from a socket - might happen quite frequently depending on network quality
		socket.get('sessionController', function(err, sessionController) {
			if (sessionController === null) return;
			sessionController.unsubscribe();
			/*var leaveMessage = JSON.stringify({action: 'control', user: sessionController.user, msg: ' left the channel' });
			sessionController.publish(leaveMessage);*/
			sessionController.destroyRedis();
		});
	});
});
