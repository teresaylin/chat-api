USE challenge;

CREATE TABLE user(id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(20), password VARCHAR(255));
CREATE TABLE thread(id INT AUTO_INCREMENT PRIMARY KEY, user_id_1 INT, user_id_2 INT);
CREATE TABLE message(id INT AUTO_INCREMENT PRIMARY KEY, time DATETIME DEFAULT CURRENT_TIMESTAMP, content TEXT, width INT, height INT, videolength INT, source TEXT, sender_id INT, thread_id INT);