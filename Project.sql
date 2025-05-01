CREATE DATABASE Project;
USE Project;

-- super table 
DROP TABLE IF EXISTS Users;
CREATE TABLE Users
(
    userID INT IDENTITY(1,1) PRIMARY KEY,
    -- Auto-increment
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    -- hashed passwords ideally
    role VARCHAR(10) NOT NULL CHECK (role IN ('Member', 'Trainer', 'Admin'))
);

DROP TABLE IF EXISTS Members;
CREATE TABLE Members
(
    memberID INT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    registrationDate DATE NOT NULL,
    membershipType VARCHAR(50) NOT NULL,
    -- Monthly, Yearly, etc.
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    CONSTRAINT fk_member_user FOREIGN KEY (memberID) REFERENCES Users(userID),
    CONSTRAINT chk_membershiptype CHECK (membershipType IN ('Monthly', 'Yearly', 'Custom'))
);

CREATE TABLE Trainers
(
    trainerID INT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    specialization VARCHAR(100) NOT NULL
);

ALTER TABLE Members  
ADD CONSTRAINT fk_members_users 
FOREIGN KEY (memberID) REFERENCES Users(userID) 
ON UPDATE CASCADE;

ALTER TABLE Trainers  
ADD CONSTRAINT fk_trainers_users 
FOREIGN KEY (trainerID) REFERENCES Users(userID) 
ON UPDATE CASCADE;

CREATE TABLE Equipment
(
    equipmentID INT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    qty INT NOT NULL
);


CREATE TABLE PaymentHistory
(
    paymentID INT PRIMARY KEY,
    memberID INT,
    amount DECIMAL(10,2) NOT NULL,
    paymentMethod VARCHAR(50) NOT NULL,
    paymentDate DATE NOT NULL,
    CONSTRAINT fk_member_payment FOREIGN KEY (memberID) REFERENCES Members(memberID)
);

ALTER TABLE PaymentHistory  
ADD CONSTRAINT chk_PaymentHistory CHECK (paymentMethod IN ('Card', 'Cash'));

ALTER TABLE PaymentHistory
DROP CONSTRAINT fk_member_payment;

ALTER TABLE PaymentHistory  
ADD CONSTRAINT fk_member_payment 
FOREIGN KEY (memberID) REFERENCES Members(memberID) 
ON UPDATE CASCADE;

CREATE TABLE Expenses
(
    expenseID INT PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    expenseDate DATE NOT NULL,
    description TEXT NOT NULL
);


CREATE TABLE Attendance
(
    memberID INT,
    date DATE,
    checkInTime TIME NOT NULL,
    checkOutTime TIME,
    PRIMARY KEY (memberID, date),
    CONSTRAINT fk_attendance_member FOREIGN KEY (memberID) REFERENCES Members(memberID)
);


CREATE TABLE WorkoutSessions
(
    sessionID INT PRIMARY KEY,
    trainerID INT,
    sessionType VARCHAR(50) NOT NULL,
    sessionDate DATE NOT NULL,
    startTime TIME NOT NULL,
    endTime TIME,
    CONSTRAINT fk_session_trainer FOREIGN KEY (trainerID) REFERENCES Trainers(trainerID)
);

CREATE TABLE Bookings
(
    bookingID INT PRIMARY KEY,
    memberID INT,
    sessionID INT,
    bookingDate DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Confirmed', 'Cancelled')),
    CONSTRAINT fk_booking_member FOREIGN KEY (memberID) REFERENCES Members(memberID),
    CONSTRAINT fk_booking_session FOREIGN KEY (sessionID) REFERENCES WorkoutSessions(sessionID)
);

ALTER TABLE Bookings
DROP CONSTRAINT CK__Bookings__status__6754599E;
-- Drop the old constraint

ALTER TABLE Bookings
ADD CONSTRAINT CK__Bookings__status CHECK (status IN ('Pending', 'Confirmed', 'Cancelled'));
-- Add the new constraint


CREATE TABLE TrainerSchedules
(
    scheduleID INT PRIMARY KEY,
    trainerID INT,
    availableDays VARCHAR(50) NOT NULL,
    -- Example: "Mon-Wed-Fri"
    startTime TIME NOT NULL,
    endTime TIME NOT NULL,
    CONSTRAINT fk_schedule_trainer FOREIGN KEY (trainerID) REFERENCES Trainers(trainerID)
);


CREATE TABLE Sales
(
    saleID INT PRIMARY KEY,
    productName VARCHAR(100) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    saleDate DATE NOT NULL
);


CREATE TABLE Supplier
(
    supplierID INT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    contact VARCHAR(20) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    productSupplied VARCHAR(100) NOT NULL
);


CREATE TABLE ProductInventory
(
    productID INT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    stockQty INT NOT NULL
)
GO

-- BASIC VIEWS 

-- 1. AttendanceSummary: Daily attendance counts (each day with total number of members who checked in)
CREATE VIEW AttendanceSummary
AS
    SELECT date, COUNT(memberID) AS attendance_count
    FROM Attendance
    GROUP BY date;
GO

-- 2. MaxAttendanceDay: The day(s) with the maximum attendance
CREATE VIEW MaxAttendanceDay
AS
    SELECT date AS max_attendance_day, attendance_count
    FROM (
    SELECT date, COUNT(memberID) AS attendance_count
        FROM Attendance
        GROUP BY date
) AS Daily
    WHERE attendance_count = (
    SELECT MAX(attendance_count)
    FROM (
        SELECT COUNT(memberID) AS attendance_count
        FROM Attendance
        GROUP BY date
    ) AS DailyMax
);
GO

-- 3. MembershipExpiringThisWeek: Members whose membership end_date is within the next 7 days
CREATE VIEW MembershipExpiringThisWeek
AS
    SELECT memberID, name, email, phone, end_date
    FROM Members
    WHERE end_date BETWEEN GETDATE() AND DATEADD(WEEK, 1, GETDATE());
GO

-- 4. LowStockEquipment: Equipment with stock quantity less than 5
CREATE VIEW LowStockEquipment
AS
    SELECT equipmentID, name, category, qty
    FROM Equipment
    WHERE qty < 5;
GO

-- 5. Top5MembersByPayment: Top 5 members by total payment amount received (highest paying members)
CREATE VIEW Top5MembersByPayment
AS
    SELECT TOP 5
        M.memberID, M.name, COALESCE(SUM(P.amount), 0) AS total_payment
    FROM Members M
        LEFT JOIN PaymentHistory P ON M.memberID = P.memberID
    GROUP BY M.memberID, M.name
    ORDER BY total_payment DESC;
GO

-- 6. TrainerScheduleOverview: List of trainers with their available days and times
CREATE VIEW TrainerScheduleOverview
AS
    SELECT T.trainerID, T.name, TS.availableDays, TS.startTime, TS.endTime
    FROM Trainers T
        INNER JOIN TrainerSchedules TS ON T.trainerID = TS.trainerID;
GO

-- 7. DailySalesSummary: Total sales amount grouped by sale date
CREATE VIEW DailySalesSummary
AS
    SELECT saleDate, SUM(amount) AS total_sales
    FROM Sales
    GROUP BY saleDate;
GO

-- 8. RecentExpenses: Expenses recorded in the last 30 days
CREATE VIEW RecentExpenses
AS
    SELECT expenseID, category, amount, expenseDate, description
    FROM Expenses
    WHERE expenseDate >= DATEADD(DAY, -30, GETDATE());
GO

-- 9: MembershipSubscriptionCount - Number of members by subscription type
CREATE VIEW MembershipSubscriptionCount
AS
    SELECT membershipType, COUNT(*) AS member_count
    FROM Members
    GROUP BY membershipType;
GO

-- 10: PaymentAmountForMonthlyAndCustom - Total payments from members with "Month" or "Custom" membership
CREATE VIEW PaymentAmountForMonthlyAndCustom
AS
    SELECT membershipType, SUM(P.amount) AS total_payments
    FROM Members M
        INNER JOIN PaymentHistory P ON M.memberID = P.memberID
    WHERE membershipType IN ('Month', 'Custom')
    GROUP BY membershipType;
GO

-- 11: MembersLeftPreviousMonth - Members whose membership expired in the previous month
CREATE VIEW MembersLeftPreviousMonth
AS
    SELECT memberID, name, email, phone, registrationDate, membershipType, start_date, end_date
    FROM Members
    WHERE MONTH(end_date) = MONTH(DATEADD(MONTH, -1, GETDATE()))
        AND YEAR(end_date) = YEAR(DATEADD(MONTH, -1, GETDATE()));
GO

CREATE OR ALTER PROCEDURE sp_RegisterNewMember
    @name VARCHAR(100),
    @email VARCHAR(100),
    @phone VARCHAR(20),
    @username VARCHAR(50),
    @password VARCHAR(255),
    @membershipType VARCHAR(50)
AS
BEGIN
    DECLARE @newUserID INT;

    -- Step 1: Insert into Users
    INSERT INTO Users
        (name, email, phone, username, password, role)
    VALUES
        (@name, @email, @phone, @username, @password, 'Member');

    SET @newUserID = SCOPE_IDENTITY();

    -- Step 2: Insert into Members
    INSERT INTO Members
        (
        memberID, name, email, phone, registrationDate, membershipType, start_date, end_date
        )
    VALUES
        (
            @newUserID, @name, @email, @phone, GETDATE(), @membershipType, GETDATE(),
            CASE 
            WHEN @membershipType = 'Monthly' THEN DATEADD(MONTH, 1, GETDATE())
            WHEN @membershipType = 'Yearly' THEN DATEADD(YEAR, 1, GETDATE())
            ELSE DATEADD(DAY, 30, GETDATE())
        END
    );
END;

ALTER TABLE Users ADD passwordHash VARCHAR(255) NOT NULL;

ALTER TABLE Users DROP COLUMN password;

ALTER TABLE Users
ADD CONSTRAINT DF_Role DEFAULT 'member' FOR role;


SELECT*
FROM Users;

SELECT*
FROM Members;

SELECT*
FROM Trainers;

SELECT*
FROM Equipment;

SELECT*
FROM PaymentHistory;

SELECT*
FROM Expenses;

SELECT*
FROM Attendance;

SELECT*
FROM WorkoutSessions;

SELECT*
FROM Bookings;

SELECT*
FROM TrainerSchedules;

SELECT*
FROM Sales;

SELECT*
FROM Supplier;

SELECT*
FROM ProductInventory;
GO

ALTER TABLE Attendance
DROP CONSTRAINT fk_attendance_member;