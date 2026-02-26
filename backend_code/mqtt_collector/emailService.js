// Load nodemailer library.
const nodemailer = require("nodemailer");

function createTransportFromEnv() {
    // Gather environment configurations.
    const host = process.env.SMTP_HOST; // Hosted by gmail.
    const port = Number(process.env.SMTP_PORT || 587); // Port number.
    const user = process.env.SMTP_USER; // Email address.
    const pass = process.env.SMTP_PASS; // App password.

    // If any are missing.
    if (!host || !user || !pass) {
        // Throw error.
        throw new Error("Missing SMTP env vars (SMTP_HOST, SMTP_USER, SMTP_PASS).");
    }

    // Transporter object.
    return nodemailer.createTransport({
        host: host,
        port: port,
        secure: (port === 465),
        auth: {
            user: user,
            pass: pass
        }
    });
}

// Send the email.
async function sendAlertEmail(transporter, to, from, subject, bodyText) {
    await transporter.sendMail({
        to: to,
        from: from,
        subject: subject,
        text: bodyText
    });
}

// Allow functions to be accessed by other files.
module.exports = { createTransportFromEnv, sendAlertEmail };