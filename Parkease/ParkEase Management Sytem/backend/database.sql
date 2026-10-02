CREATE DATABASE IF NOT EXISTS parkease
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE parkease;

CREATE TABLE IF NOT EXISTS admins (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL DEFAULT 'Administrator',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    id TINYINT UNSIGNED PRIMARY KEY,
    hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 10.00,
    cash_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    online_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parking_spaces (
    id VARCHAR(10) PRIMARY KEY,
    status ENUM('available','occupied')
        NOT NULL DEFAULT 'available',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parking_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(30) NOT NULL UNIQUE,
    plate_number VARCHAR(30) NOT NULL,
    parking_space_id VARCHAR(10) NOT NULL,
    started_at DATETIME NOT NULL,

    UNIQUE KEY uq_active_session_plate (plate_number),
    UNIQUE KEY uq_active_session_space (parking_space_id),
    FOREIGN KEY (parking_space_id)
        REFERENCES parking_spaces(id)
);

CREATE TABLE IF NOT EXISTS tickets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ticket_number VARCHAR(30) NOT NULL UNIQUE,
    session_code VARCHAR(30) NOT NULL,
    plate_number VARCHAR(30) NOT NULL,
    parking_space_id VARCHAR(10) NOT NULL,
    hours INT UNSIGNED NOT NULL,
    duration_text VARCHAR(100) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method ENUM('cash','online') NOT NULL,
    entry_time DATETIME NOT NULL,
    paid_at DATETIME NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PAID',

    FOREIGN KEY (parking_space_id)
        REFERENCES parking_spaces(id),

    INDEX idx_ticket_plate (plate_number),
    INDEX idx_ticket_paid_at (paid_at)
);

INSERT INTO settings
(id, hourly_rate, cash_enabled, online_enabled)
VALUES
(1, 10.00, TRUE, TRUE)
ON DUPLICATE KEY UPDATE id = id;
