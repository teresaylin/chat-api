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
 * HTTP POST /users
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





app.listen(8000, function() {
    console.log('Listening on port 8000');
});
