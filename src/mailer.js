import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import path from 'path';
import { fileURLToPath } from 'url';

const _filename = fileURLToPath(import.meta.url);
const dir = path.dirname(_filename);

dotenv.config({path: `${dir}/.env`});

const apiKey = process.env.RESEND_API_KEY;

const frontEndDomain = "https://www.pvpscalpel.com/";

const transporter = nodemailer.createTransport({
    host : 'smtp.resend.com',
    port: 587,
    secure: false,
    auth: {
        user: 'resend',
        pass: apiKey
    },
});

const mail = {
    sendJWT : async function (email, token) {
        const link = frontEndDomain + `verify?token=${token}`;
        const html = `
        <h2>Email Verification</h2>
        <p>Click the link below to verify your email address:</p>
        <a href="${link}" target="_blank">${link}</a>
      
        <br /><br />
      
        <p>
          Thank you for being part of us!<br />
          Best regards,<br />
          <strong>PvP Scalpel's team</strong>
        </p>
      `;

        await transporter.sendMail({
            from: 'noreply@pvpscalpel.com',
            to: email,
            subject: "Email verification",
            html: html,
        })
    }
}

mail.sendJWT(`l.stanev2000@gmail.com`, `TEST`)