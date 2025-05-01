require('dotenv').config(); // Load environment variables
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const bcrypt = require('bcryptjs');  // Import bcryptjs for hashing passwords
const jwt = require('jsonwebtoken'); // Import jwt for token generation
const path = require('path');  // Require path module

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend'))); 

// Database Configuration using .env variables
const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
        trustServerCertificate: true,
        enableArithAbort: true,
    },
    port: process.env.DB_PORT || 1433,  // Ensure this is explicitly set
};

// Connect to DB
sql.connect(config)
    .then(() => console.log("✅ Connected to the database"))
    .catch((err) => console.error("❌ DB connection failed:", err));

// Routes
app.get('/', (req, res) => {
    return res.json('Message from Backend');
});

// Middleware to verify token and check if the user is admin
function verifyAdmin(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];  // Get token from Authorization header
    
    if (!token) {
        return res.status(403).json({ message: "No token provided" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: "Failed to authenticate token" });
        }

        // Check if the user role is 'admin'
        if (decoded.role.toLowerCase() !== "admin") {
            return res.status(403).json({ message: "Unauthorized access!" });
        }

        req.user = decoded;  // Store user info in request
        next();  // Proceed to the next middleware or route handler
    });
}


// ----- USERS ENDPOINTS -----

// Reset Password Route
app.put('/users/:userID/reset-password', async (req, res) => {
    const userID = req.params.userID;
    const { newPassword } = req.body;

    // Check if the new password is provided
    if (!newPassword) {
        return res.status(400).json({ message: "New password is required" });
    }

    // Hash the new password before saving it
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    try {
        // Declare the parameters
        const request = new sql.Request();
        request.input('userID', sql.Int, userID); // Declare userID as an integer parameter
        request.input('hashedPassword', sql.NVarChar, hashedPassword); // Declare hashedPassword as a string parameter

        // Use parameterized query to update the password
        const result = await request.query(`
            UPDATE Users
            SET passwordHash = @hashedPassword
            WHERE userID = @userID
        `);

        if (result.rowsAffected === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        // Send success response
        res.status(200).json({ message: "Password updated successfully" });
    } catch (err) {
        console.error("Error updating password:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// Cancel Membership Route
app.delete('/memberships/:userID', async (req, res) => {
    const userID = req.params.userID;

    try {
        // Start a transaction to ensure both tables are updated together
        const transaction = new sql.Transaction();
        await transaction.begin();

        // Declare the userID parameter for both queries
        const request = new sql.Request(transaction);
        request.input('userID', sql.Int, userID); // Declare the userID parameter

        // Delete membership record
        await request.query(`
            DELETE FROM Members
            WHERE memberID = @userID
        `);

        // Delete user record
        await request.query(`
            DELETE FROM Users
            WHERE userID = @userID
        `);

        // Commit the transaction
        await transaction.commit();

        // Send success response
        res.status(200).json({ message: "Membership and account deleted successfully" });
    } catch (err) {
        // If something goes wrong, rollback the transaction
        await transaction.rollback();
        console.error("Error canceling membership:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// Protect the /users route (Only allow admins)
app.get("/users", verifyAdmin, async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM Users");
        res.status(200).json(result.recordset); // Send back the result as JSON
    } catch (err) {
        console.error("❌ Error fetching users:", err.message);
        res.status(500).json({ message: "Failed to fetch users" });
    }
});

// Add a User (Force add a user without adding to Members or Trainers)
app.post("/usersno", async (req, res) => {
    const { username, password, name, email, phone, role = undefined } = req.body;

    if (!username || !password || !name || !email || !phone) {
        return res.status(400).json({ message: "All fields are required" });
    }

    try {
        // Check if username already exists
        const userCheck = await sql.query`SELECT * FROM Users WHERE username = ${username}`;
        if (userCheck.recordset.length > 0) {
            return res.status(400).json({ message: "Username already exists" });
        }

        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert into Users table (without adding to Members or Trainers)
        await sql.query`
            INSERT INTO Users (username, passwordHash, name, email, phone, role)
            VALUES (${username}, ${hashedPassword}, ${name}, ${email}, ${phone}, ${role})
        `;

        res.status(201).json({ message: "User added successfully (not added to Members or Trainers)" });
    } catch (err) {
        console.error("❌ Error adding user:", err.message);
        res.status(500).json({ message: "Failed to add user" });
    }
});

// Post a User (Sign-up)
app.post("/users", async (req, res) => {
    const { username, password, name, email, phone, role = 'Member' } = req.body;

    if (!username || !password || !name || !email || !phone) {
        return res.status(400).json({ message: "All fields are required" }); // Send error message as JSON
    }

    try {
        // Check if username already exists in the database
        const userCheck = await sql.query`SELECT * FROM Users WHERE username = ${username}`;
        if (userCheck.recordset.length > 0) {
            return res.status(400).json({ message: "Username already exists" }); // Send error message as JSON
        }

        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert the new user into the Users table
        await sql.query`
            INSERT INTO Users (username, passwordHash, name, email, phone, role)
            VALUES (${username}, ${hashedPassword}, ${name}, ${email}, ${phone}, ${role})
        `;

        // Get the userID of the newly inserted user
        const result = await sql.query`SELECT userID FROM Users WHERE username = ${username}`;
        const userID = result.recordset[0].userID;

        // Insert the user as a member by default in the Members table
        await sql.query`
            INSERT INTO Members (memberID, name, email, phone, registrationDate, membershipType, start_date, end_date)
            VALUES (${userID}, ${name}, ${email}, ${phone}, GETDATE(), 'Monthly', GETDATE(), DATEADD(YEAR, 1, GETDATE()))
        `;

        // Generate JWT Token
        const token = jwt.sign({ userID, username, role }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(201).json({
            message: "User added successfully",
            token, // Send the JWT token back to the frontend
        });
    } catch (err) {
        console.error("❌ Error adding user:", err.message);
        res.status(500).json({ message: "Failed to add user" }); // Send error message as JSON
    }
});

// Update a user
app.put("/users/:id", async (req, res) => {
    const { id } = req.params;
    const { name, email, phone, role } = req.body;

    if (!name || !email || !phone || !role) {
        return res.status(400).json({ message: "All fields are required to update the user" }); // Send error message as JSON
    }

    try {
        const result = await sql.query`
            UPDATE Users 
            SET name = ${name}, email = ${email}, phone = ${phone}, role = ${role} 
            WHERE userID = ${id}
        `;

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ message: "User not found" }); // Send error message as JSON
        }

        res.status(200).json({ message: "User updated successfully" });
    } catch (err) {
        console.error("❌ Failed to update user:", err.message);
        res.status(500).json({ message: "Failed to update user" }); // Send error message as JSON
    }
});

// Delete a User
app.delete("/users/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const result = await sql.query`DELETE FROM Users WHERE userID = ${id}`;

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ message: "User not found" }); // Send error message as JSON
        }

        res.status(200).json({ message: "User deleted successfully" });
    } catch (err) {
        console.error("❌ Failed to delete user:", err.message);
        res.status(500).json({ message: "Failed to delete user" }); // Send error message as JSON
    }
});

// ----- MEMBERS ENDPOINTS -----

// Protecting the /members route so only admins can access it
app.get("/members", verifyAdmin, async (req, res) => {
    try {
        // Sync data between Users and Members
        await sql.query(`
            UPDATE m
            SET m.name = u.name, m.email = u.email, m.phone = u.phone
            FROM Members m
            JOIN Users u ON m.memberID = u.userID
        `);

        // Fetch all member data
        const result = await sql.query(`
            SELECT memberID, name, email, phone, registrationDate, membershipType, start_date, end_date
            FROM Members
        `);

        res.status(200).json(result.recordset);
    } catch (err) {
        console.error("❌ Failed to fetch Members:", err.message);
        res.status(500).json({ message: "Failed to fetch Members" });
    }
});

// Get member info by ID (to display on the dashboard)
app.get("/member/:id", async (req, res) => {
    const memberID = req.params.id;  // Get memberID from the URL parameter

    try {
        // Fetch member data based on memberID
        const result = await sql.query(`
            SELECT name, email, phone, membershipType, registrationDate
            FROM Members
            WHERE memberID = ${memberID}
        `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ message: "Member not found" });  // If no member found
        }

        res.status(200).json(result.recordset[0]);  // Send member data to frontend
    } catch (err) {
        console.error("❌ Error fetching member data:", err.message);
        res.status(500).send("Error fetching member data");
    }
});

// Add a Member (Force add a member without adding to Users or Trainers)
app.post("/members", async (req, res) => {
    const { memberID, registrationDate, membershipType, start_date, end_date } = req.body;

    if (!memberID || !registrationDate || !membershipType || !start_date || !end_date) {
        return res.status(400).json({ message: "All inputs are required" }); // Send error message as JSON
    }

    try {
        // Check if the user with the provided memberID exists
        const result = await sql.query`SELECT * FROM Users WHERE userID = ${memberID}`;
        const user = result.recordset[0];

        if (!user) {
            return res.status(404).json({ message: "User with provided memberID not found" }); // Send error message as JSON
        }

        // Define and pass parameters to the query
        const request = new sql.Request();
        request.input('memberID', sql.Int, memberID);
        request.input('name', sql.NVarChar, user.name);
        request.input('email', sql.NVarChar, user.email);
        request.input('phone', sql.NVarChar, user.phone);
        request.input('registrationDate', sql.Date, registrationDate);
        request.input('membershipType', sql.NVarChar, membershipType);
        request.input('start_date', sql.Date, start_date);
        request.input('end_date', sql.Date, end_date);

        // Insert into Members table using parameterized query
        await request.query(`
            INSERT INTO Members (memberID, name, email, phone, registrationDate, membershipType, start_date, end_date) 
            VALUES (@memberID, @name, @email, @phone, @registrationDate, @membershipType, @start_date, @end_date)
        `);

        res.status(201).json({ message: "Member added successfully" });
    } catch (err) {
        console.error("❌ Failed to insert member:", err.message);
        res.status(500).json({ message: "Failed to insert member" }); // Send error message as JSON
    }
});

// Update a Member (Edit member details)
app.put("/member/:id", async (req, res) => {
    const { id } = req.params;
    const { membershipType, start_date, end_date } = req.body;
  
    if (!membershipType || !start_date || !end_date) {
      return res.status(400).json({ message: "All fields are required to update the member" });
    }
  
    try {
      const result = await sql.query`
        UPDATE Members 
        SET membershipType = ${membershipType}, start_date = ${start_date}, end_date = ${end_date}
        WHERE memberID = ${id}
      `;
  
      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({ message: "Member not found" });
      }
  
      res.status(200).json({ message: "Member updated successfully" });
    } catch (err) {
      console.error("❌ Failed to update member:", err.message);
      res.status(500).json({ message: "Failed to update member" });
    }
});
  
// Delete a Member
app.delete("/members/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const result = await sql.query`DELETE FROM Members WHERE memberID = ${id}`;

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ message: "Member not found" });
        }

        res.status(200).json({ message: "Member deleted successfully" });
    } catch (err) {
        console.error("❌ Failed to delete member:", err.message);
        res.status(500).json({ message: "Failed to delete member" });
    }
});

// ----- TRAINERS ENDPOINTS -----

// Get all Trainers with user info from Users table
app.get("/trainers", async (req, res) => {
    try {
        // Sync data between Users and Trainers
        await sql.query(`
            UPDATE t
            SET t.name = u.name, t.email = u.email, t.phone = u.phone
            FROM Trainers t
            JOIN Users u ON t.trainerID = u.userID
        `);

        // Fetch all trainer data
        const result = await sql.query(`
            SELECT trainerID, name, email, phone, specialization
            FROM Trainers
        `);

        // Send the result as JSON
        res.status(200).json(result.recordset);
    } catch (err) {
        console.error("❌ Failed to fetch Trainers:", err.message);
        res.status(500).json({ message: "Failed to fetch Trainers" });
    }
});

app.get("/trainer/:id", async (req, res) => {
    const trainerID = req.params.id;

    try {
        const result = await sql.query`
            SELECT * FROM Trainers WHERE trainerID = ${trainerID}
        `;
        if (result.recordset.length === 0) {
            return res.status(404).json({ message: "Trainer not found" });
        }

        return res.status(200).json(result.recordset[0]);
    } catch (err) {
        console.error("❌ Error fetching trainer:", err.message);
        return res.status(500).json({ message: "Error fetching trainer" });
    }
});

// Delete a Trainer by trainerID
app.delete("/trainers/:id", async (req, res) => {
    const { id } = req.params; // Extract the trainerID from the request parameters

    try {
        // First, check if the trainer exists
        const result = await sql.query(`
            SELECT * FROM Trainers WHERE trainerID = ${id}
        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: "Trainer not found" });
        }

        // Delete the trainer by trainerID
        await sql.query(`
            DELETE FROM Trainers WHERE trainerID = ${id}
        `);

        // Optionally, delete the related user in the Users table (if needed)
        await sql.query(`
            DELETE FROM Users WHERE userID = ${id}
        `);

        res.status(200).json({ message: "Trainer deleted successfully" });
    } catch (err) {
        console.error("❌ Error deleting trainer:", err.message);
        res.status(500).json({ message: "Failed to delete trainer" });
    }
});

// Get user info based on role
app.get("/dashboard/:id", async (req, res) => {
    const userID = req.params.id;

    try {
        // Step 1: Get the user's role
        const userResult = await sql.query`
            SELECT userID, name, email, phone, role FROM Users WHERE userID = ${userID}
        `;

        if (userResult.recordset.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const user = userResult.recordset[0];

        // Step 2: Fetch additional info if role is member or trainer
        if (user.role.toLowerCase() === "member") {
            const memberResult = await sql.query`
                SELECT membershipType, registrationDate 
                FROM Members 
                WHERE memberID = ${userID}
            `;
            const member = memberResult.recordset[0] || {};
            return res.status(200).json({ ...user, ...member });
        }

        if (user.role.toLowerCase() === "trainer") {
            const trainerResult = await sql.query`
                SELECT specialization 
                FROM Trainers 
                WHERE trainerID = ${userID}
            `;
            const trainer = trainerResult.recordset[0] || {};
            return res.status(200).json({ ...user, ...trainer });
        }

        // If admin, just return basic user info
        return res.status(200).json(user);

    } catch (err) {
        console.error("❌ Error fetching dashboard data:", err.message);
        res.status(500).json({ message: "Error fetching dashboard data" });
    }
});

// ADMIN INFO
app.get("/admin/:id", async (req, res) => {
    const adminID = req.params.id;

    try {
        const result = await sql.query`
            SELECT userID, name, email, phone FROM Users WHERE userID = ${adminID} AND role = 'admin'
        `;
        if (result.recordset.length === 0) {
            return res.status(404).json({ message: "Admin not found" });
        }

        return res.status(200).json(result.recordset[0]);
    } catch (err) {
        console.error("❌ Error fetching admin:", err.message);
        return res.status(500).json({ message: "Error fetching admin" });
    }
});

// ----- LOGIN ENDPOINTS -----

// ----- LOGIN -----
app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        console.log("Login attempt:", username);

        const result = await sql.query`
            SELECT * FROM Users WHERE username = ${username}
        `;

        if (result.recordset.length === 0) {
            return res.status(400).json({ message: "Username not found" });
        }

        const user = result.recordset[0];

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(400).json({ message: "Invalid password" });
        }

        const token = jwt.sign(
            { userID: user.userID, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        return res.status(200).json({
            message: "Login successful",
            token,
            role: user.role
        });

    } catch (err) {
        console.error("❌ Error during login:", err.message);
        return res.status(500).json({ message: "Login failed. Server error." });
    }
});
// ---------------------------------TESTED------------------------------------------------
// --- EQUIPMENT ENDPOINTS ---

// POST Equipment (adding new equipment with manual equipmentID)
app.post("/equipment", async (req, res) => {
    const { equipmentID, name, category, qty } = req.body;

    if (!equipmentID || !name || !category || !qty) {
        return res.status(400).send("All fields are required");
    }

    try {
        const result = await sql.query`
            INSERT INTO Equipment (equipmentID, name, category, qty) 
            VALUES (${equipmentID}, ${name}, ${category}, ${qty})
        `;
        
        res.status(201).send("Equipment added successfully");
    } catch (err) {
        console.error("❌ Failed to insert equipment:", err.message);
        res.status(500).send("Failed to add equipment");
    }
});

// GET all Equipment (fetch all equipment)
app.get("/equipment", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM Equipment");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Equipment:", err.message);
        res.status(500).send("Failed to fetch Equipment");
    }
});

// GET Equipment by ID (fetch specific equipment)
app.get("/equipment/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM Equipment WHERE equipmentID = ${id}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Equipment not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific equipment as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Equipment:", err.message);
        res.status(500).send("Failed to fetch Equipment");
    }
});

// PUT (update) Equipment (updating an existing equipment)
app.put("/equipment/:id", async (req, res) => {
    const { id } = req.params;
    const { name, category, qty } = req.body;

    if (!name || !category || !qty) {
        return res.status(400).send("All fields are required");
    }

    try {
        const result = await sql.query`
            UPDATE Equipment
            SET name = ${name}, category = ${category}, qty = ${qty}
            WHERE equipmentID = ${id}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Equipment not found");
        }

        res.status(200).send("Equipment updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Equipment:", err.message);
        res.status(500).send("Failed to update Equipment");
    }
});

// DELETE Equipment (deleting an equipment)
app.delete("/equipment/:id", async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM Equipment WHERE equipmentID = ${id}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Equipment not found");
        }

        res.status(200).send("Equipment deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Equipment:", err.message);
        res.status(500).send("Failed to delete Equipment");
    }
});

// --- TRAINERS ENDPOINTS ---

// POST a Trainer (fetch name, email, phone from Users table using userID)
app.post("/trainers", async (req, res) => {
    const { userID, specialization } = req.body;

    // Only validate userID and specialization
    if (!userID || !specialization) {
        return res.status(400).send("userID and specialization are required");
    }

    try {
        // Check if the userID exists in the Users table
        const userCheck = await sql.query`
            SELECT * FROM Users WHERE userID = ${userID}
        `;
        
        if (userCheck.recordset.length === 0) {
            return res.status(400).send("The provided userID does not exist");
        }

        // Fetch the user's details (name, email, phone)
        const user = userCheck.recordset[0];
        const { name, email, phone } = user;

        // Insert the new trainer using the fetched user details and provided specialization
        const result = await sql.query`
            INSERT INTO Trainers (trainerID, name, email, phone, specialization)
            VALUES (${userID}, ${name}, ${email}, ${phone}, ${specialization})
        `;
        
        res.status(201).send("Trainer added successfully");
    } catch (err) {
        console.error("❌ Failed to insert trainer:", err.message);
        res.status(500).send("Failed to add trainer");
    }
});

// GET all Trainers
app.get("/trainers", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM Trainers");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Trainers:", err.message);
        res.status(500).send("Failed to fetch Trainers");
    }
});

// GET Trainer by ID
app.get("/trainers/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM Trainers WHERE trainerID = ${id}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Trainer not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific trainer as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Trainer:", err.message);
        res.status(500).send("Failed to fetch Trainer");
    }
});

// PUT (update) a Trainer
app.put("/trainers/:id", async (req, res) => {
    const { id } = req.params;  // Trainer ID from URL
    const { specialization } = req.body;  // Get specialization from the body

    if (!specialization) {
        return res.status(400).send("Specialization is required");
    }

    try {
        // Check if the trainer exists in the Trainers table
        const trainerCheck = await sql.query`
            SELECT * FROM Trainers WHERE trainerID = ${id}
        `;
        
        if (trainerCheck.recordset.length === 0) {
            return res.status(404).send("Trainer not found");
        }

        // Update only the specialization field
        const result = await sql.query`
            UPDATE Trainers
            SET specialization = ${specialization}
            WHERE trainerID = ${id}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Trainer update failed");
        }

        res.status(200).send("Trainer updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Trainer:", err.message);
        res.status(500).send("Failed to update Trainer");
    }
});

// DELETE a Trainer
app.delete("/trainers/:id", async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM Trainers WHERE trainerID = ${id}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Trainer not found");
        }

        res.status(200).send("Trainer deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Trainer:", err.message);
        res.status(500).send("Failed to delete Trainer");
    }
});

// --- TRAINER SCHEDULES ENDPOINTS ---

// POST a new Trainer Schedule
app.post("/trainerSchedules", async (req, res) => {
    const { scheduleID, trainerID, availableDays, startTime, endTime } = req.body;

    if (!scheduleID || !trainerID || !availableDays || !startTime || !endTime) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Check if trainerID exists in the Trainers table
        const trainerCheck = await sql.query`
            SELECT * FROM Trainers WHERE trainerID = ${trainerID}
        `;
        
        if (trainerCheck.recordset.length === 0) {
            return res.status(400).send("The provided trainerID does not exist");
        }

        // Insert the new trainer schedule record
        const result = await sql.query`
            INSERT INTO TrainerSchedules (scheduleID, trainerID, availableDays, startTime, endTime)
            VALUES (${scheduleID}, ${trainerID}, ${availableDays}, ${startTime}, ${endTime})
        `;
        
        res.status(201).send("Trainer schedule added successfully");
    } catch (err) {
        console.error("❌ Failed to insert trainer schedule:", err.message);
        res.status(500).send("Failed to add trainer schedule");
    }
});

// GET all Trainer Schedules
app.get("/trainerSchedules", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM TrainerSchedules");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Trainer Schedules:", err.message);
        res.status(500).send("Failed to fetch Trainer Schedules");
    }
});

// GET Trainer Schedule by ID (for a specific schedule)
app.get("/trainerSchedules/:scheduleID", async (req, res) => {
    const { scheduleID } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM TrainerSchedules WHERE scheduleID = ${scheduleID}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Trainer schedule not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific trainer schedule as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Trainer Schedule:", err.message);
        res.status(500).send("Failed to fetch Trainer Schedule");
    }
});

// PUT (update) a Trainer Schedule
app.put("/trainerSchedules/:scheduleID", async (req, res) => {
    const { scheduleID } = req.params;
    const { trainerID, availableDays, startTime, endTime } = req.body;

    if (!trainerID || !availableDays || !startTime || !endTime) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Check if trainerID exists in the Trainers table
        const trainerCheck = await sql.query`
            SELECT * FROM Trainers WHERE trainerID = ${trainerID}
        `;
        
        if (trainerCheck.recordset.length === 0) {
            return res.status(400).send("The provided trainerID does not exist");
        }

        // Update the trainer schedule record
        const result = await sql.query`
            UPDATE TrainerSchedules
            SET trainerID = ${trainerID}, availableDays = ${availableDays}, startTime = ${startTime}, endTime = ${endTime}
            WHERE scheduleID = ${scheduleID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Trainer schedule not found");
        }

        res.status(200).send("Trainer schedule updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Trainer Schedule:", err.message);
        res.status(500).send("Failed to update Trainer Schedule");
    }
});

// DELETE a Trainer Schedule
app.delete("/trainerSchedules/:scheduleID", async (req, res) => {
    const { scheduleID } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM TrainerSchedules WHERE scheduleID = ${scheduleID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Trainer schedule not found");
        }

        res.status(200).send("Trainer schedule deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Trainer Schedule:", err.message);
        res.status(500).send("Failed to delete Trainer Schedule");
    }
});

// --- WORKOUT SESSIONS ENDPOINTS ---

// POST a new Workout Session
app.post("/workoutSessions", async (req, res) => {
    const { sessionID, trainerID, sessionType, sessionDate, startTime, endTime } = req.body;

    if (!sessionID || !trainerID || !sessionType || !sessionDate || !startTime) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Check if trainerID exists in the Trainers table
        const trainerCheck = await sql.query`
            SELECT * FROM Trainers WHERE trainerID = ${trainerID}
        `;
        
        if (trainerCheck.recordset.length === 0) {
            return res.status(400).send("The provided trainerID does not exist");
        }

        // Insert the new workout session record
        const result = await sql.query`
            INSERT INTO WorkoutSessions (sessionID, trainerID, sessionType, sessionDate, startTime, endTime)
            VALUES (${sessionID}, ${trainerID}, ${sessionType}, ${sessionDate}, ${startTime}, ${endTime})
        `;
        
        res.status(201).send("Workout session added successfully");
    } catch (err) {
        console.error("❌ Failed to insert workout session:", err.message);
        res.status(500).send("Failed to add workout session");
    }
});

// GET all Workout Sessions
app.get("/workoutSessions", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM WorkoutSessions");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Workout Sessions:", err.message);
        res.status(500).send("Failed to fetch Workout Sessions");
    }
});

// GET Workout Session by ID (for a specific session)
app.get("/workoutSessions/:sessionID", async (req, res) => {
    const { sessionID } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM WorkoutSessions WHERE sessionID = ${sessionID}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Workout session not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific workout session as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Workout Session:", err.message);
        res.status(500).send("Failed to fetch Workout Session");
    }
});

// PUT (update) a Workout Session
app.put("/workoutSessions/:sessionID", async (req, res) => {
    const { sessionID } = req.params;
    const { trainerID, sessionType, sessionDate, startTime, endTime } = req.body;

    if (!trainerID || !sessionType || !sessionDate || !startTime) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Check if trainerID exists in the Trainers table
        const trainerCheck = await sql.query`
            SELECT * FROM Trainers WHERE trainerID = ${trainerID}
        `;
        
        if (trainerCheck.recordset.length === 0) {
            return res.status(400).send("The provided trainerID does not exist");
        }

        // Update the workout session record
        const result = await sql.query`
            UPDATE WorkoutSessions
            SET trainerID = ${trainerID}, sessionType = ${sessionType}, sessionDate = ${sessionDate}, startTime = ${startTime}, endTime = ${endTime}
            WHERE sessionID = ${sessionID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Workout session not found");
        }

        res.status(200).send("Workout session updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Workout Session:", err.message);
        res.status(500).send("Failed to update Workout Session");
    }
});

// DELETE a Workout Session
app.delete("/workoutSessions/:sessionID", async (req, res) => {
    const { sessionID } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM WorkoutSessions WHERE sessionID = ${sessionID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Workout session not found");
        }

        res.status(200).send("Workout session deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Workout Session:", err.message);
        res.status(500).send("Failed to delete Workout Session");
    }
});

// --- BOOKINGS ENDPOINTS ---

// POST a new Booking
app.post("/bookings", async (req, res) => {
    const { bookingID, memberID, sessionID, bookingDate, status } = req.body;

    if (!bookingID || !memberID || !sessionID || !bookingDate || !status) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Check if memberID exists in the Members table
        const memberCheck = await sql.query`
            SELECT * FROM Members WHERE memberID = ${memberID}
        `;
        
        if (memberCheck.recordset.length === 0) {
            return res.status(400).send("The provided memberID does not exist");
        }

        // Check if sessionID exists in the WorkoutSessions table
        const sessionCheck = await sql.query`
            SELECT * FROM WorkoutSessions WHERE sessionID = ${sessionID}
        `;
        
        if (sessionCheck.recordset.length === 0) {
            return res.status(400).send("The provided sessionID does not exist");
        }

        // Insert the new booking record
        const result = await sql.query`
            INSERT INTO Bookings (bookingID, memberID, sessionID, bookingDate, status)
            VALUES (${bookingID}, ${memberID}, ${sessionID}, ${bookingDate}, ${status})
        `;
        
        res.status(201).send("Booking added successfully");
    } catch (err) {
        console.error("❌ Failed to insert booking:", err.message);
        res.status(500).send("Failed to add booking");
    }
});

// GET all Bookings
app.get("/bookings", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM Bookings");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Bookings:", err.message);
        res.status(500).send("Failed to fetch Bookings");
    }
});

// GET Booking by ID
app.get("/bookings/:bookingID", async (req, res) => {
    const { bookingID } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM Bookings WHERE bookingID = ${bookingID}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Booking not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific booking as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Booking:", err.message);
        res.status(500).send("Failed to fetch Booking");
    }
});

// PUT (update) a Booking
app.put("/bookings/:bookingID", async (req, res) => {
    const { bookingID } = req.params;
    const { memberID, sessionID, bookingDate, status } = req.body;

    if (!memberID || !sessionID || !bookingDate || !status) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Check if memberID exists in the Members table
        const memberCheck = await sql.query`
            SELECT * FROM Members WHERE memberID = ${memberID}
        `;
        
        if (memberCheck.recordset.length === 0) {
            return res.status(400).send("The provided memberID does not exist");
        }

        // Check if sessionID exists in the WorkoutSessions table
        const sessionCheck = await sql.query`
            SELECT * FROM WorkoutSessions WHERE sessionID = ${sessionID}
        `;
        
        if (sessionCheck.recordset.length === 0) {
            return res.status(400).send("The provided sessionID does not exist");
        }

        // Update the booking record
        const result = await sql.query`
            UPDATE Bookings
            SET memberID = ${memberID}, sessionID = ${sessionID}, bookingDate = ${bookingDate}, status = ${status}
            WHERE bookingID = ${bookingID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Booking not found");
        }

        res.status(200).send("Booking updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Booking:", err.message);
        res.status(500).send("Failed to update Booking");
    }
});

// DELETE a Booking
app.delete("/bookings/:bookingID", async (req, res) => {
    const { bookingID } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM Bookings WHERE bookingID = ${bookingID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Booking not found");
        }

        res.status(200).send("Booking deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Booking:", err.message);
        res.status(500).send("Failed to delete Booking");
    }
});

// --- ATTENDANCE ENDPOINTS ---

// POST a new Attendance
app.post("/attendance", async (req, res) => {
    const { memberID, date, checkInTime, checkOutTime } = req.body;

    if (!memberID || !date || !checkInTime) {
        return res.status(400).send("memberID, date, and checkInTime are required");
    }

    try {
        // Check if memberID exists in the Members table
        const memberCheck = await sql.query`
            SELECT * FROM Members WHERE memberID = ${memberID}
        `;
        
        if (memberCheck.recordset.length === 0) {
            return res.status(400).send("The provided memberID does not exist");
        }

        // Insert the new attendance record
        const result = await sql.query`
            INSERT INTO Attendance (memberID, date, checkInTime, checkOutTime)
            VALUES (${memberID}, ${date}, ${checkInTime}, ${checkOutTime})
        `;
        
        res.status(201).send("Attendance added successfully");
    } catch (err) {
        console.error("❌ Failed to insert attendance:", err.message);
        res.status(500).send("Failed to add attendance");
    }
});

// POST: Check in attendance
app.post("/check-in-attendance", async (req, res) => {
    const { memberID, date, checkInTime } = req.body;
  
    if (!memberID || !date || !checkInTime) {
      return res.status(400).send("memberID, date, and checkInTime are required");
    }
  
    try {
      // Convert date and checkInTime to the correct format
      const formattedDate = new Date(date).toISOString().split('T')[0]; // Ensure date is in YYYY-MM-DD format
      const formattedTime = new Date(`1970-01-01T${checkInTime}Z`).toISOString().split('T')[1]; // Ensure time is in HH:MM:SS format
  
      // Insert the new attendance record
      await sql.query`
        INSERT INTO Attendance (memberID, date, checkInTime)
        VALUES (${memberID}, ${formattedDate}, ${formattedTime})
      `;
      res.status(201).send("Attendance checked in successfully");
    } catch (err) {
      console.error("❌ Failed to insert attendance:", err.message);
      res.status(500).send("Failed to check in attendance");
    }
});  

// GET all Attendance records
app.get("/attendance", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM Attendance");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Attendance:", err.message);
        res.status(500).send("Failed to fetch Attendance");
    }
});

// GET: Fetch past attendance
app.get("/member-attendance/:userID", async (req, res) => {
    const userID = req.params.userID;
  
    try {
      const result = await sql.query(`
        SELECT date, checkInTime, checkOutTime
        FROM Attendance
        WHERE memberID = ${userID}
      `);
  
      if (result.recordset.length === 0) {
        return res.status(404).json({ message: "No attendance records found" });
      }
  
      res.status(200).json(result.recordset);
    } catch (err) {
      console.error("❌ Error fetching attendance:", err.message);
      res.status(500).json({ message: "Failed to fetch attendance records" });
    }
});

// GET Attendance by ID (for a specific member on a specific date)
app.get("/attendance/:memberID/:date", async (req, res) => {
    const { memberID, date } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM Attendance WHERE memberID = ${memberID} AND date = ${date}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Attendance not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific attendance record as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Attendance:", err.message);
        res.status(500).send("Failed to fetch Attendance");
    }
});

// PUT (update) Attendance (updating an existing attendance record)
app.put("/attendance/:memberID/:date", async (req, res) => {
    const { memberID, date } = req.params;
    const { checkInTime, checkOutTime } = req.body;

    if (!checkInTime) {
        return res.status(400).send("checkInTime is required");
    }

    try {
        // Check if memberID exists in the Members table
        const memberCheck = await sql.query`
            SELECT * FROM Members WHERE memberID = ${memberID}
        `;
        
        if (memberCheck.recordset.length === 0) {
            return res.status(400).send("The provided memberID does not exist");
        }

        // Update the attendance record
        const result = await sql.query`
            UPDATE Attendance
            SET checkInTime = ${checkInTime}, checkOutTime = ${checkOutTime}
            WHERE memberID = ${memberID} AND date = ${date}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Attendance not found");
        }

        res.status(200).send("Attendance updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Attendance:", err.message);
        res.status(500).send("Failed to update Attendance");
    }
});

// DELETE an Attendance record
app.delete("/attendance/:memberID/:date", async (req, res) => {
    const { memberID, date } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM Attendance WHERE memberID = ${memberID} AND date = ${date}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Attendance not found");
        }

        res.status(200).send("Attendance deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Attendance:", err.message);
        res.status(500).send("Failed to delete Attendance");
    }
});

// --------------------------------------- TESTED PRODUCT INVENTORY --------------------------------------------------

// --- PRODUCT INVENTORY ENDPOINTS ---

// POST a new Product
app.post("/productInventory", async (req, res) => {
    const { productID, name, price, stockQty } = req.body;

    if (!productID || !name || !price || !stockQty) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Insert the new product record
        const result = await sql.query`
            INSERT INTO ProductInventory (productID, name, price, stockQty)
            VALUES (${productID}, ${name}, ${price}, ${stockQty})
        `;
        
        res.status(201).send("Product added successfully");
    } catch (err) {
        console.error("❌ Failed to insert product:", err.message);
        res.status(500).send("Failed to add product");
    }
});

// GET all Products
app.get("/productInventory", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM ProductInventory");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Products:", err.message);
        res.status(500).send("Failed to fetch Products");
    }
});

// GET Product by ID
app.get("/productInventory/:productID", async (req, res) => {
    const { productID } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM ProductInventory WHERE productID = ${productID}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Product not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific product as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Product:", err.message);
        res.status(500).send("Failed to fetch Product");
    }
});

// PUT (update) a Product
app.put("/productInventory/:productID", async (req, res) => {
    const { productID } = req.params;
    const { name, price, stockQty } = req.body;

    if (!name || !price || !stockQty) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Update the product record
        const result = await sql.query`
            UPDATE ProductInventory
            SET name = ${name}, price = ${price}, stockQty = ${stockQty}
            WHERE productID = ${productID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Product not found");
        }

        res.status(200).send("Product updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Product:", err.message);
        res.status(500).send("Failed to update Product");
    }
});

// DELETE a Product
app.delete("/productInventory/:productID", async (req, res) => {
    const { productID } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM ProductInventory WHERE productID = ${productID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Product not found");
        }

        res.status(200).send("Product deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Product:", err.message);
        res.status(500).send("Failed to delete Product");
    }
});



// ----------------------------------------- TESTED SALES -----------------------------------------------



// --- SALES ENDPOINTS ---

// POST a new Sale
app.post("/sales", async (req, res) => {
    const { saleID, productName, amount, saleDate } = req.body;

    if (!saleID || !productName || !amount || !saleDate) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Insert the new sale record
        const result = await sql.query`
            INSERT INTO Sales (saleID, productName, amount, saleDate)
            VALUES (${saleID}, ${productName}, ${amount}, ${saleDate})
        `;
        
        res.status(201).send("Sale added successfully");
    } catch (err) {
        console.error("❌ Failed to insert sale:", err.message);
        res.status(500).send("Failed to add sale");
    }
});

// GET all Sales
app.get("/sales", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM Sales");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Sales:", err.message);
        res.status(500).send("Failed to fetch Sales");
    }
});

// GET Sale by ID
app.get("/sales/:saleID", async (req, res) => {
    const { saleID } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM Sales WHERE saleID = ${saleID}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Sale not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific sale as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Sale:", err.message);
        res.status(500).send("Failed to fetch Sale");
    }
});

// PUT (update) a Sale
app.put("/sales/:saleID", async (req, res) => {
    const { saleID } = req.params;
    const { productName, amount, saleDate } = req.body;

    if (!productName || !amount || !saleDate) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Update the sale record
        const result = await sql.query`
            UPDATE Sales
            SET productName = ${productName}, amount = ${amount}, saleDate = ${saleDate}
            WHERE saleID = ${saleID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Sale not found");
        }

        res.status(200).send("Sale updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Sale:", err.message);
        res.status(500).send("Failed to update Sale");
    }
});

// DELETE a Sale
app.delete("/sales/:saleID", async (req, res) => {
    const { saleID } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM Sales WHERE saleID = ${saleID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Sale not found");
        }

        res.status(200).send("Sale deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Sale:", err.message);
        res.status(500).send("Failed to delete Sale");
    }
});

// ------------------------ TESTED SUPPLIER ------------------------- 

// --- SUPPLIER ENDPOINTS ---

// POST a new Supplier
app.post("/suppliers", async (req, res) => {
    const { supplierID, name, contact, email, productSupplied } = req.body;

    if (!supplierID || !name || !contact || !email || !productSupplied) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Insert the new supplier record
        const result = await sql.query`
            INSERT INTO Supplier (supplierID, name, contact, email, productSupplied)
            VALUES (${supplierID}, ${name}, ${contact}, ${email}, ${productSupplied})
        `;
        
        res.status(201).send("Supplier added successfully");
    } catch (err) {
        console.error("❌ Failed to insert supplier:", err.message);
        res.status(500).send("Failed to add supplier");
    }
});

// GET all Suppliers
app.get("/suppliers", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM Supplier");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Suppliers:", err.message);
        res.status(500).send("Failed to fetch Suppliers");
    }
});

// GET Supplier by ID
app.get("/suppliers/:supplierID", async (req, res) => {
    const { supplierID } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM Supplier WHERE supplierID = ${supplierID}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Supplier not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific supplier as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Supplier:", err.message);
        res.status(500).send("Failed to fetch Supplier");
    }
});

// PUT (update) a Supplier
app.put("/suppliers/:supplierID", async (req, res) => {
    const { supplierID } = req.params;
    const { name, contact, email, productSupplied } = req.body;

    if (!name || !contact || !email || !productSupplied) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Update the supplier record
        const result = await sql.query`
            UPDATE Supplier
            SET name = ${name}, contact = ${contact}, email = ${email}, productSupplied = ${productSupplied}
            WHERE supplierID = ${supplierID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Supplier not found");
        }

        res.status(200).send("Supplier updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Supplier:", err.message);
        res.status(500).send("Failed to update Supplier");
    }
});

// DELETE a Supplier
app.delete("/suppliers/:supplierID", async (req, res) => {
    const { supplierID } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM Supplier WHERE supplierID = ${supplierID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Supplier not found");
        }

        res.status(200).send("Supplier deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Supplier:", err.message);
        res.status(500).send("Failed to delete Supplier");
    }
});



// ---------------------------------- TESTED EXPENSES -------------------------------------

// POST a new Expense
app.post("/expenses", async (req, res) => {
    const { expenseID, category, amount, expenseDate, description } = req.body;

    if (!expenseID || !category || !amount || !expenseDate || !description) {
        return res.status(400).send("All fields are required");
    }

    try {
        const result = await sql.query`
            INSERT INTO Expenses (expenseID, category, amount, expenseDate, description)
            VALUES (${expenseID}, ${category}, ${amount}, ${expenseDate}, ${description})
        `;
        
        res.status(201).send("Expense added successfully");
    } catch (err) {
        console.error("❌ Failed to insert expense:", err.message);
        res.status(500).send("Failed to add expense");
    }
});

// GET all Expenses
app.get("/expenses", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM Expenses");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Expenses:", err.message);
        res.status(500).send("Failed to fetch Expenses");
    }
});

// GET Expense by ID
app.get("/expenses/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM Expenses WHERE expenseID = ${id}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Expense not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific expense as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Expense:", err.message);
        res.status(500).send("Failed to fetch Expense");
    }
});

// PUT (update) an Expense
app.put("/expenses/:id", async (req, res) => {
    const { id } = req.params;
    const { category, amount, expenseDate, description } = req.body;

    if (!category || !amount || !expenseDate || !description) {
        return res.status(400).send("All fields are required");
    }

    try {
        const result = await sql.query`
            UPDATE Expenses
            SET category = ${category}, amount = ${amount}, expenseDate = ${expenseDate}, description = ${description}
            WHERE expenseID = ${id}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Expense not found");
        }

        res.status(200).send("Expense updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Expense:", err.message);
        res.status(500).send("Failed to update Expense");
    }
});

// DELETE an Expense
app.delete("/expenses/:id", async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM Expenses WHERE expenseID = ${id}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Expense not found");
        }

        res.status(200).send("Expense deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Expense:", err.message);
        res.status(500).send("Failed to delete Expense");
    }
});


// ---------------------------------- TESTED PAYMENT HISTORY ------------------------------

// --- PAYMENT HISTORY ENDPOINTS ---

// POST a new Payment
app.post("/paymentHistory", async (req, res) => {
    const { paymentID, memberID, amount, paymentMethod, paymentDate } = req.body;

    if (!paymentID || !memberID || !amount || !paymentMethod || !paymentDate) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Check if memberID exists in the Members table
        const memberCheck = await sql.query`
            SELECT * FROM Members WHERE memberID = ${memberID}
        `;
        
        if (memberCheck.recordset.length === 0) {
            return res.status(400).send("The provided memberID does not exist");
        }

        // Insert the new payment record
        const result = await sql.query`
            INSERT INTO PaymentHistory (paymentID, memberID, amount, paymentMethod, paymentDate)
            VALUES (${paymentID}, ${memberID}, ${amount}, ${paymentMethod}, ${paymentDate})
        `;
        
        res.status(201).send("Payment added successfully");
    } catch (err) {
        console.error("❌ Failed to insert payment:", err.message);
        res.status(500).send("Failed to add payment");
    }
});

// GET all PaymentHistory records
app.get("/paymentHistory", async (req, res) => {
    try {
        const result = await sql.query("SELECT * FROM PaymentHistory");
        res.status(200).json(result.recordset); // Return as JSON
    } catch (err) {
        console.error("❌ Failed to fetch PaymentHistory:", err.message);
        res.status(500).send("Failed to fetch PaymentHistory");
    }
});

// GET Payment by ID
app.get("/paymentHistory/:paymentID", async (req, res) => {
    const { paymentID } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM PaymentHistory WHERE paymentID = ${paymentID}
        `;
        
        if (result.recordset.length === 0) {
            return res.status(404).send("Payment not found");
        }
        
        res.status(200).json(result.recordset[0]); // Return the specific payment as JSON
    } catch (err) {
        console.error("❌ Failed to fetch Payment:", err.message);
        res.status(500).send("Failed to fetch Payment");
    }
});

// PUT (update) a Payment
app.put("/paymentHistory/:paymentID", async (req, res) => {
    const { paymentID } = req.params;
    const { memberID, amount, paymentMethod, paymentDate } = req.body;

    if (!memberID || !amount || !paymentMethod || !paymentDate) {
        return res.status(400).send("All fields are required");
    }

    try {
        // Check if memberID exists in the Members table
        const memberCheck = await sql.query`
            SELECT * FROM Members WHERE memberID = ${memberID}
        `;
        
        if (memberCheck.recordset.length === 0) {
            return res.status(400).send("The provided memberID does not exist");
        }

        // Update the payment record
        const result = await sql.query`
            UPDATE PaymentHistory
            SET memberID = ${memberID}, amount = ${amount}, paymentMethod = ${paymentMethod}, paymentDate = ${paymentDate}
            WHERE paymentID = ${paymentID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Payment not found");
        }

        res.status(200).send("Payment updated successfully");
    } catch (err) {
        console.error("❌ Failed to update Payment:", err.message);
        res.status(500).send("Failed to update Payment");
    }
});

// DELETE a Payment
app.delete("/paymentHistory/:paymentID", async (req, res) => {
    const { paymentID } = req.params;
    
    try {
        const result = await sql.query`
            DELETE FROM PaymentHistory WHERE paymentID = ${paymentID}
        `;
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).send("Payment not found");
        }

        res.status(200).send("Payment deleted successfully");
    } catch (err) {
        console.error("❌ Failed to delete Payment:", err.message);
        res.status(500).send("Failed to delete Payment");
    }
});

// ----------------------------------- TESTED TRAINER SCHEDULES IN DASHBOARD ---------------------------------------

app.get('/trainer-schedule/:trainerID', async (req, res) => {
    const { trainerID } = req.params;
    try {
      const result = await sql.query`
        SELECT * FROM TrainerScheduleOverview WHERE trainerID = ${trainerID}
      `;
      res.json(result.recordset);
    } catch (err) {
      console.error("Error fetching trainer schedule:", err.message);
      res.status(500).send("Server error");
    }
});

// Start the server
app.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
});