const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const mysql = require("mysql2/promise");
const { prependListener } = require("process");
const fs = require("fs");
const ExcelJS = require("exceljs");
require("dotenv").config();

let connection;

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            preload: path.join(__dirname, "Backend/preload.js"),
        },
    });

    win.loadFile("public/index.html");
    win.maximize();
}
if (require('electron-squirrel-startup')) app.quit();
app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

async function connectToDB() {
    // Corrected function name and async keyword
    try {
        connection = await mysql.createConnection({
        // Assign connection to the global variable
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
        });
    } catch (error) {
        // Added error parameter
        console.error("Error connecting to database:", error); // Corrected log message and added error parameter
    }
}

// Call connectToDB function when app is ready
app.whenReady().then(connectToDB);

ipcMain.on("insertMilestone", async (event, data) => {
    const { rowDataArray, projectData } = data;
    var c_name = projectData.customerName;

    try {
        const [result] = await connection.execute(
            `SELECT cin FROM customers where company_name = '${c_name}'`
        );
        const cin = result[0].cin;

        rowDataArray.forEach((rowData) => {
            const { milestone, claimPercentage, amount } = rowData;
            const query = `INSERT INTO milestones (cin, pono, milestone_name, claim_percent, amount) VALUES (?, ?, ?, ?, ?)`;
            connection.query(
                query,
                [cin, projectData.poNo, milestone, claimPercentage, amount],
                (error, results, fields) => {
                    if (error) throw error;
                }
            );
        });
    } catch (error) {
        console.error("Error inserting project data:", error);
    }
});

ipcMain.on("createProject", async (event, data) => {
    const { projectData } = data;
    var c_name = projectData.customerName;

    try {
        const [result] = await connection.execute(
            `SELECT cin FROM customers where company_name = '${c_name}'`
        );
        const cin = result[0].cin;

        const insertProjectQuery = `
          INSERT INTO projects (cin, pono, total_prices, taxes, project_name)
          VALUES (?, ?, ?, ?, ?)
        `;
        await connection.query(insertProjectQuery, [
            cin,
            projectData.poNo,
            projectData.totalPrice,
            projectData.taxTypes[0], // Assuming taxTypes is an array and you want to insert the first element
            projectData.projectName,
        ]);

        console.log("Data inserted successfully");
    } catch (error) {
        console.error("Error inserting project data:", error);
    }
});

ipcMain.on("createCustomer", async (event, data) => {
    const { customerData } = data;
    try {
        const insertCustomerQuery = `
          INSERT INTO customers (company_name, address, phone, gstin, pan, cin)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        await connection.query(insertCustomerQuery, [
            customerData.companyName,
            customerData.address,
            customerData.phone,
            customerData.gstin,
            customerData.pan,
            customerData.cin,
        ]);

        console.log("Data inserted successfully");
    } catch (error) {
        console.error("Error inserting data:", error);
    }
});

ipcMain.on("createInvoice", async (event, data) => {
    const invoiceData = data.invoiceData; // Accessing the 'invoiceData' property

    // Extract formData and milestones from invoiceData
    const { formData, milestones } = invoiceData; 
    // Inserting data into Invoices table
    milestones.forEach(async (milestone) => {
        try {
            await connection.query(`
                INSERT INTO Invoices (cin, pono, company_name, project_name, invoice_number, invoice_date, due_date, taxes_excluded, total_prices, milestone_name, remaining_amount)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                milestone.cin,
                milestone.pono,
                formData.customer,
                formData.project,
                formData.invoiceNumber,
                formData.invoiceDate,
                formData.dueDate,
                milestone.amount,  // Taxes excluded (set to null for now)
                milestone.amount,  // Total prices (set to null for now)
                milestone.milestone_name,
                calculateRemainingAmount(milestone)
            ]); 
            console.log("Data inserted successfully");
        } catch (error) {
            console.error("Error inserting data:", error);
        }

    })

    function calculateRemainingAmount(milestone) {
        // Extract the total amount and total paid amount directly from the milestone object
        const totalAmount = parseFloat(milestone.total_prices);
        const totalPaidAmount = parseFloat(milestone.amount);

        // Calculate the remaining amount
        const remainingAmount = totalAmount - totalPaidAmount;

        return remainingAmount;
    }

    async function updateMilestoneStatus(milestones) {
        const updateStatusQuery = `
            UPDATE milestones
            SET status = 'paid'
            WHERE cin = ? AND pono = ? AND milestone_name IN (?)
        `;

        const milestoneNames = milestones.map(
            (milestone) => milestone.milestone_name
        );
        await connection.query(updateStatusQuery, [
            milestones[0].cin,
            milestones[0].pono,
            milestoneNames,
        ]);
    }
    await updateMilestoneStatus(milestones);
});

ipcMain.on("createForm", async (event, data) => {
    //sending data to excel
    const invoiceData = data.invoiceData;
    const { formData, milestones } = invoiceData;
    const workbook = new ExcelJS.Workbook();
    workbook.xlsx
        .readFile("IEC_Invoice_template.xlsx")
        .then(() => {
            const worksheet = workbook.getWorksheet("Invoice 2");
            if (worksheet) {
            // Update cell values with invoice data
                worksheet.getCell("A13").value = formData.customer;
                worksheet.getCell("A14").value = formData.project;
                worksheet.getCell("F4").value = formData.invoiceNumber;
                worksheet.getCell("F3").value = formData.invoiceDate;
                worksheet.getCell("F5").value = formData.dueDate;
                worksheet.getCell("A21").value = formData.description;
                return workbook.xlsx.writeFile("generatedInvoice.xlsx");
            } else {
                throw new Error("Worksheet not found in the Excel file.");
            }
        })
        .then(() => {
            console.log("Invoice generated successfully!");
        })
        .catch((error) => {
            console.error(error);
        });
});

ipcMain.handle("fetchData", async (event) => {
    try {
        const [customer_rows] = await connection.execute("SELECT * FROM customers");
        const [milestone_rows] = await connection.execute(
            "SELECT * FROM milestones"
        );
        const [project_rows] = await connection.execute(
            "SELECT * FROM projects"
        );
        const [invoice_rows] = await connection.execute(
            "SELECT * FROM invoices"
        );
        return { customers: customer_rows, milestones: milestone_rows, projects: project_rows, invoices: invoice_rows };
    } catch (error) {
        console.error("Error fetching data from database:", error);
    }
});

ipcMain.handle("fetchCustomer", async (event) => {
    try {
        const [company_name] = await connection.execute(
            "SELECT company_name FROM customers"
        );
        return { company_name };
    } catch (error) {
        console.error("Error fetching data from database:", error);
    }
});
// ipcMain.handle("fetchInvoices", async (event) => {
//     try {
//         const [invoicedata] = await connection.execute(
//             "SELECT * FROM invoices"
//         );
//         return { invoicedata };
//     } catch (error) {
//         console.error("Error fetching data from database:", error);
//     }
// });
// ipcMain.handle("fetchStatus", async (event, invoicedata) => {
//     try {
//         const [status] = await connection.execute(
//             "SELECT status FROM milestones"
//         );
//         return { status };
//     } catch (error) {
//         console.error("Error fetching data from database:", error);
//     }
// });

ipcMain.handle("fetchProject", async (event, companyName) => {
    try {
        const [projects] = await connection.execute(
            "SELECT projects.project_name FROM projects INNER JOIN customers ON projects.cin = customers.cin WHERE customers.company_name = ?",
            [companyName]
        );
        return { projects };
    } catch (error) {
        console.error("Error fetching data from database:", error);
    }
});
ipcMain.handle("fetchMilestones", async (event, projectName) => {
    try {
        const [milestones] = await connection.execute(
            "SELECT * FROM milestones INNER JOIN projects ON milestones.cin = projects.cin AND milestones.pono = projects.pono WHERE projects.project_name = ?",
            [projectName]
        );
        return { milestones };
    } catch (error) {
        console.error("Error fetching data from database:", error);
    }
});
// Close database connection when app is quit
app.on("quit", () => {
    if (connection) {
    // Check if connection exists before trying to end it
        connection.end();
    }
});
