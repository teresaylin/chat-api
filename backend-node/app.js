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
    console.log("Creating new user...");

    db.getConnection(function (err, connection) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }
        
        // first check if username is taken
        connection.query("SELECT username FROM user WHERE username = '" + user.username + "'", function (err, results) {
            if (err) {
                // error querying db
                res.status(400).send(err.message);
                connection.release();
                return;
            }
            if (results.length==0) {
                // insert into db
                bcrypt.hash(user.password, 10, function(err, hash) {
                    var insertquery = "INSERT INTO user(username, password) VALUES ('" + user.username + "', '" + hash + "')";
                    connection.query(insertquery, function (err, results) {
                        if (err) {
                            res.status(400).send(err.message);
                            return;
                        }
                        console.log("Created user: " + user.username);
                        res.status(200).send("Successfully added user!");
                    });
                });
            } else {
                // found username so return error
                res.status(400).send("Username already taken!");
            }
            connection.release();
        });
    });
    console.log("Done");
});

/**
 * Prepares a message to be added to the database.
 * 
 * @param connection - current connection to the database
 * @param threadID - ID of the thread to which the message belongs
 * @param senderID - ID of the user who sent the message
 * @param message - message (text-only, image link, or video link)
 *        image can only be JPG, PNG, or GIF
 *        videos can only be from youtube or vevo
 * @param {success: true/false, message: "[response conveying status of message]"}
 */
var sendMessage = function(connection, threadID, senderID, message, callback) {
    // parse message for text-only vs image link vs video link
    if (message.includes(".jpg") || message.includes(".png") || message.includes(".gif")) {
        // save metadata: width and height hardcoded to 500 and 400 pixels respectively
        console.log("Found image link");
        var insertMessage = "INSERT INTO message(content, sender_id, thread_id, width, height) VALUES ('" + message + "', " + senderID + ", " + threadID + ", " + 500 + ", " + 400 + ")";
        createNewMessage(connection, insertMessage, threadID, function (data) {
            callback(data);
            return;
        });
    } else if (message.includes("youtube") || message.includes("vevo")) {
        // save metadata: videolength hardcoded to 60 minutes * 60 seconds = 3600 seconds
        console.log("Found video link");
        var src = message.includes("youtube") ? "Youtube" : "Vevo";
        var insertMessage = "INSERT INTO message(content, sender_id, thread_id, videolength, source) VALUES ('" + message + "', " + senderID + ", " + threadID + ", " + 3600 + ", '" + src + "')";
        createNewMessage(connection, insertMessage, threadID, function (data) {
            callback(data);
            return;
        });
    } else {
        // text message
        console.log("Text only message");
        var insertMessage = "INSERT INTO message(content, sender_id, thread_id) VALUES ('" + message + "', " + senderID + ", " + threadID + ")";
        createNewMessage(connection, insertMessage, threadID, function (data) {
            callback(data);
            return;
        });
    }
};

/**
 * Adds a new message to the database.
 * 
 * @param connection - current connection to the database
 * @param query - the insert statement for the db to execute
 * @param threadID - ID of the thread to which the message belongs
 * @param {success: true/false, message: "[response conveying status of message]"}
 */
var createNewMessage = function(connection, query, threadID, callback) {
    connection.query(query, function (err, results) {
        if (err) {
            callback({ success: false, message: "Message not sent. Try again!"});
            return;
        }
        callback({ success: true, message: "Message sent!" });
    });
};

/**
 * Gets all the messages between two users, ordered from oldest to newest.
 * 
 * @param  username1 - username of one user
 * @param  username2 - username of other user
 * @return 200 HTTP code, or 404 HTTP code if error getting messages
 *
 * Example request: curl -i http://localhost:18000/messages/bob/teresa
 */
app.get('/messages/:username1/:username2', function (req, res) {
    var request = req.params;
    console.log("Fetching messages between " + request.username1 + " and " + request.username2);

    db.getConnection(function (err, connection) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }

        // check that both sender and recipient exist
        connection.query("SELECT id, username FROM user WHERE username = '" + request.username1 + "' OR username = '" + request.username2 + "'", function (err, results) {
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
                    if (results.length > 1) {
                        res.status(404).send("Error: more than 1 thread found between " + request.username1 + " and " + request.username2);
                    }
                    else if (results.length == 0) {
                        // no thread exists
                        res.status(404).send("0 messages between " + request.username1 + " and " + request.username2);
                    } else if (results.length == 1) {
                        // found a thread
                        var threadID = results[0].id;
                        var messageQuery = "SELECT content AS message, sender_id AS sender, time FROM message WHERE thread_id = " + threadID + " ORDER BY time ASC";

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
        console.log("Done");
    });
});

/**
 * Given a specified number X of messages, fetches the oldest X messages between two users.
 * 
 * @param  username1 - username of one user
 * @param  username2 - username of other user
 * @param  number - number of messages to display
 * @return 200 HTTP code, or 404 HTTP code if error getting messages
 *
 * Example request: curl -i http://localhost:18000/messages/bob/teresa/numMessages/3
 */
app.get('/messages/:username1/:username2/numMessages/:number', function (req, res) {
    var request = req.params;
    var numMsgs = request.number;
    console.log("Fetching first " + numMsgs + " messages between " + request.username1 + " and " + request.username2);

    db.getConnection(function (err, connection) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }

        // check that both sender and recipient exist
        connection.query("SELECT id, username FROM user WHERE username = '" + request.username1 + "' OR username = '" + request.username2 + "'", function (err, results) {
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
                    if (results.length > 1) {
                        res.status(404).send("Error: more than 1 thread found between " + request.username1 + " and " + request.username2);
                    }
                    else if (results.length == 0) {
                        // no thread exists
                        res.status(404).send("0 messages between " + request.username1 + " and " + request.username2);
                    } else if (results.length == 1) {
                        // found a thread
                        var threadID = results[0].id;
                        var messageQuery = "SELECT content AS message, sender_id AS sender, time FROM message WHERE thread_id = " + threadID + " ORDER BY time ASC LIMIT " + numMsgs;

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
        console.log("Done");
    });
});

/**
 * Gets a specific page and a specified number of messages between two users, ordered from oldest to newest.
 * 
 * @param  username1 - username of one user
 * @param  username2 - username of other user
 * @param  number - number of messages to display
 * @param  pagenumber - page of messages to display, must be >= 1
 * @return 200 HTTP code, or 404 HTTP code if error getting messages
 *
 * Example request: curl -i http://localhost:18000/messages/bob/teresa/numMessages/3/page/2
 */
app.get('/messages/:username1/:username2/numMessages/:number/page/:pagenumber', function (req, res) {
    var request = req.params;
    var numMsgs = request.number;
    var page = request.pagenumber;
    console.log("Fetching page " + page + " of messages between " + request.username1 + " and " + request.username2);

    db.getConnection(function (err, connection) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }

        // check that both sender and recipient exist
        connection.query("SELECT id, username FROM user WHERE username = '" + request.username1 + "' OR username = '" + request.username2 + "'", function (err, results) {
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
                    if (results.length > 1) {
                        res.status(404).send("Error: more than 1 thread found between " + request.username1 + " and " + request.username2);
                    }
                    else if (results.length == 0) {
                        // no thread exists
                        res.status(404).send("0 messages between " + request.username1 + " and " + request.username2);
                    } else if (results.length == 1) {
                        // found a thread
                        var threadID = results[0].id;
                        var offset = numMsgs * (page-1);
                        var messageQuery = "SELECT content AS message, sender_id AS sender, time FROM message WHERE thread_id = " + threadID + " ORDER BY time ASC LIMIT " + numMsgs + " OFFSET " + offset;

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
        console.log("Done");
    });
});

/**
 * Sends a message from one user to another.
 * 
 * @param  req - JSON containing 'from', 'to', and 'message'
 *         'from'    - username of sender
 *         'to'      - username of recipient
 *         'message' - text-only, an image link, or a video link
 * @return 200 HTTP code, or 400 HTTP code if error sending message
 *
 * Example request: curl -i -X POST http://localhost:18000/messages -d '{"from":"teresa", "to":"bob", "message":"hi"}' -H "Content-Type: application/json"
 */
app.post('/messages', function (req, res) {
    var msg = req.body;
    console.log("Sending new message");

    db.getConnection(function (err, connection) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }

        // check that both sender and recipient exist
        connection.query("SELECT id, username FROM user WHERE username = '" + msg.from + "' OR username = '" + msg.to + "'", function (err, results) {
            if (err) {
                // error querying db
                res.status(400).send(err.message);
                connection.release();
                return;
            }
            if (results.length==2) {
                // both sender and recipient exist in db
                var sender = results[0].username == msg.from ? results[0] : results[1];
                var recipient = results[0].username == msg.to ? results[0] : results[1];
                // find common thread between sender and recipient if it exists
                var commonThread = "SELECT id FROM thread WHERE (user_id_1 = '" + sender.id + "' AND user_id_2 = '" + recipient.id + "') OR (user_id_1 = '" + recipient.id + "' AND user_id_2 = '" + sender.id + "')";

                connection.query(commonThread, function (err, results) {
                    if (err) {
                        res.status(400).send(err.message);
                        return;
                    }
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
                            sendMessage(connection, threadID, sender.id, msg.message, function (data) {
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
                        sendMessage(connection, threadID, sender.id, msg.message, function (data) {
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
        console.log("Done");
    });
});


app.listen(8000, function() {
    console.log('Listening on port 8000');
});
