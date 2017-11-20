const express = require('express');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');

const app = express();
const db = mysql.createPool({
    host: 'db',
    user: 'root',
    password: 'testpass',
    database: 'challenge',
});

app.use(bodyParser.json());

app.get('/test', function (req, res) {
    console.log(req.body);
    db.getConnection(function (err, connection) {
        if (err) {
            console.log("error connecting")
            res.status(400).send(err.message);
            return;
        }
        connection.query('SELECT username FROM user', function (err, results, fields) {
            if (err) {
                // error querying db
                res.status(400).send(err.message);
                connection.release();
                return;
            }
            console.log(results);
            res.json({
                usn: results[0].username,
                id: results[0].id,
                backend: 'nodejs',
            });
            connection.release();
        });
    });
});

app.get('/users/:usn', function (req, res) {
    // var user = req.body; 
    // console.log(user);   // {}
    var username = req.params.usn;
    console.log("getting user");
    console.log(username);
    db.getConnection(function (err, connection) {
        if (err) {
            console.log("error connecting");
            res.status(400).send(err.message);
            return;
        }
        connection.query("SELECT password FROM user WHERE username = '" + username + "'", function (err, results, fields) {
            if (err) {
                // error querying db
                res.status(400).send(err.message);
                connection.release();
                return;
            }
            console.log(results);
            res.json({
                usn: results[0].username
            });
            connection.release();
        });
    });
});

/**
 * Adds a new user, with a username and password.
 * 
 * @param  req - JSON containing 'username' and 'password' (ex: 'username': 'bob', 'password': 'apples'})
 * @return 200 HTTP code, or 400 HTTP code if user already exists
 *
 * Example request: curl -i -X POST http://localhost:18000/users -d '{"username":"ann", "password":"oranges"}' -H "Content-Type: application/json"
 */
app.post('/users', function (req, res) {
    var user = req.body;

    db.getConnection(function (err, connection) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }
        
        // first check if username is taken
        connection.query("SELECT username FROM user WHERE username = '" + user.username + "'", function (err, results, fields) {
            if (err) {
                // error querying db
                res.status(400).send(err.message);
                connection.release();
                return;
            }
            if (results.length==0) {
                // insert into db
                var insertquery = "INSERT INTO user(username, password) VALUES ('" + user.username + "', '" + user.password + "')";
                connection.query(insertquery, function (err, results) {
                    if (err) {
                        res.status(400).send(err.message);
                        return;
                    }
                    res.status(200).send("Successfully added user!");
                });
            } else {
                // found username so return error
                res.status(400).send("Username already taken!");
            }
            connection.release();
        });
    });
});

/**
 * Adds a new message to the database.
 * 
 * @param connection - current connection to the database
 * @param threadID - ID of the thread to which the message belongs
 * @param senderID - ID of the user who sent the message
 * @param message - message (text-only, image link, or video link)
 * @param {success: true/false, message: "[response conveying status of message]"}
 */
var addMessage = function(connection, threadID, senderID, message, callback) {
    var insertMessage = "INSERT INTO message(content, sender_id, thread_id) VALUES ('" + message + "', " + senderID + ", " + threadID + ")";
    console.log(insertMessage);

    connection.query(insertMessage, function (err, results) {
        if (err) {
            callback({ success: false, message: "Message not sent. Try again!"});
            return;
        }
        var messageID = results.insertId;

        // add to thread_message table
        var newThreadMessage = "INSERT INTO thread_message(thread_id, message_id) VALUES (" + threadID + ", " + messageID + ")";
        console.log(newThreadMessage);

        connection.query(newThreadMessage, function (err, results) {
            if (err) {
                callback({ success: false, message: "Message not sent. Please try again!"});
                return;
            }
            callback({ success: true, message: "Message sent!"});
        });
    });
}

/**
 * Gets the messages between two users, ordered from oldest to newest.
 * 
 * @param  req - JSON containing 'user1' (username), 'user2' (username)
 * @return 200 HTTP code, or 404 HTTP code if error getting messages
 */
app.get('/messages/:username1/:username2', function (req, res) {
    var request = req.params;

    db.getConnection(function (err, connection) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }

        // check that both sender and recipient exist
        connection.query("SELECT id, username FROM user WHERE username = '" + request.username1 + "' OR username = '" + request.username2 + "'", function (err, results, fields) {
            if (err) {
                // error querying db
                res.status(400).send(err.message);
                connection.release();
                return;
            }
            if (results.length==2) {
                // both sender and recipient exist in db
                // find common thread between sender and recipient if it exists
                var user1 = results[0];
                var user2 = results[1];
                var commonThread = "SELECT id FROM thread WHERE (user_id_1 = '" + user1.id + "' AND user_id_2 = '" + user2.id + "') OR (user_id_1 = '" + user2.id + "' AND user_id_2 = '" + user1.id + "')";

                connection.query(commonThread, function (err, results) {
                    if (err) {
                        res.status(400).send(err.message);
                        return;
                    }
                    console.log(results);
                    if (results.length > 1) {
                        res.status(404).send("Error: more than 1 thread found between " + request.username1 + " and " + request.username2);
                    }
                    else if (results.length == 0) {
                        // no thread exists
                        res.status(404).send("0 messages between " + request.username1 + " and " + request.username2);
                    } else if (results.length == 1) {
                        // found a thread
                        var threadID = results[0].id;
                        var messageQuery = "SELECT content, sender_id AS sender, time FROM message WHERE thread_id = " + threadID + " ORDER BY time ASC";

                        connection.query(messageQuery, function (err, results) {
                            if (err) {
                                res.status(400).send(err.message);
                                return;
                            }
                            // change sender ID to sender username for easier usability
                            var results_processed = results;
                            results_processed.forEach(function (result) {
                                var id = result["sender"];
                                result["sender"] = id == user1.id ? user1.username : user2.username;
                            });
                            res.json(results_processed);
                        });
                    }
                });
            } else {
                res.status(400).send("One or both of the users does not exist.");
            }
        });
        connection.release();
    });
});


/**
 * Sends a message from one user to another.
 * 
 * @param  req - JSON containing 'from', 'to', and 'message'
 * @return 200 HTTP code, or 400 HTTP code if error sending message
 *
 * Example request: curl -i -X POST http://localhost:18000/messages -d '{"from":"teresa", "to":"bob", "message":"hi"}' -H "Content-Type: application/json"
 */
app.post('/messages', function (req, res) {
    var msg = req.body;

    db.getConnection(function (err, connection) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }

        // check that both sender and recipient exist
        connection.query("SELECT id, username FROM user WHERE username = '" + msg.from + "' OR username = '" + msg.to + "'", function (err, results, fields) {
            if (err) {
                // error querying db
                res.status(400).send(err.message);
                connection.release();
                return;
            }
            console.log(results);
            if (results.length==2) {
                // both sender and recipient exist in db
                var sender = results[0].username == msg.from ? results[0] : results[1];
                var recipient = results[0].username == msg.to ? results[0] : results[1];
                // find common thread between sender and recipient if it exists

                // var senderThreads = "SELECT thread_id FROM user_thread WHERE user_id = '" + sender.id + "'";
                // var recipientThreads = "SELECT thread_id FROM user_thread WHERE user_id = '" + recipient.id + "'";
                // var commonThread = "SELECT thread_id FROM user_thread WHERE user_id='" + recipient.id + "' AND thread_id IN (" + senderThreads + ")";
                var commonThread = "SELECT id FROM thread WHERE (user_id_1 = '" + sender.id + "' AND user_id_2 = '" + recipient.id + "') OR (user_id_1 = '" + recipient.id + "' AND user_id_2 = '" + sender.id + "')";

                connection.query(commonThread, function (err, results) {
                    if (err) {
                        res.status(400).send(err.message);
                        return;
                    }
                    console.log(results);
                    if (results.length > 1) {
                        // more than one common thread --> error
                        res.status(400).send("Error: more than 1 thread found between " + msg.from + " and " + msg.to);
                    }
                    else if (results.length == 0) {
                        // create a new thread
                        var insertThread = "INSERT INTO thread(user_id_1, user_id_2) VALUES (" + sender.id + ", " + recipient.id + ")";
                        connection.query(insertThread, function (err, results) {
                            if (err) {
                                res.status(400).send(err.message);
                                return;
                            }
                            var threadID = results.insertId;
                            addMessage(connection, threadID, sender.id, msg.message, function (data) {
                                if (data.success) {
                                    res.status(200).send(data.message);
                                } else {
                                    res.status(400).send(data.message);
                                }
                            });
                        });
                    } else if (results.length == 1) {
                        // found a thread
                        var threadID = results[0].id;
                        addMessage(connection, threadID, sender.id, msg.message, function (data) {
                            if (data.success) {
                                res.status(200).send(data.message);
                            } else {
                                res.status(400).send(data.message);
                            }
                        });
                    }
                });
            } else {
                res.status(400).send("Sender and/or recipient do not exist in the database!");
            }
        });
        connection.release();
    });
});


app.listen(8000, function() {
    console.log('Listening on port 8000');
});
