CREATE TABLE users (
  uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  avatar TEXT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);

CREATE TABLE sessions (
    session_id VARCHAR(128) PRIMARY KEY,
    user_id UUID REFERENCES users(uuid),
    expires_at TIMESTAMP NOT NULL
);

CREATE TABLE boards (
  uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  user_id UUID REFERENCES users(uuid)
);

CREATE TABLE notes (
  uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID REFERENCES boards(uuid),
  x INT NOT NULL,
  y INT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  text TEXT,
  font_size TEXT
);

ALTER TABLE users 
ADD COLUMN chat_id BIGINT UNIQUE;

ALTER TABLE notes 
ADD COLUMN created_at TIMESTAMP DEFAULT NOW();
