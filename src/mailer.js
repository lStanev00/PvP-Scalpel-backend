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
        <div style="
          max-width: 600px;
          margin: auto;
          padding: 20px;
          font-family: Arial, sans-serif;
          background: #111827;
          color: #f9fafb;
          border-radius: 12px;
          box-shadow: 0 0 10px rgba(0,0,0,0.3);
        ">
          <h2 style="color: #38bdf8;">🔒 Email Verification</h2>
          <p style="line-height: 1.6;">
            Thank you for registering at <strong>PvP Scalpel</strong>.<br />
            Please click the button below to verify your email address:
          </p>
      
          <div style="text-align: center; margin: 30px 0;">
            <a href="${link}" target="_blank" style="
              background: #38bdf8;
              color: #000;
              padding: 12px 24px;
              text-decoration: none;
              font-weight: bold;
              border-radius: 6px;
              display: inline-block;
            ">Verify Email</a>
          </div>
      
          <p style="font-size: 14px; color: #9ca3af;">
            If you didn’t create an account, you can ignore this email.
          </p>
      
          <hr style="border: none; border-top: 1px solid #374151; margin: 20px 0;" />
      
          <p style="font-size: 12px; color: #6b7280;">
            ⚔️ Stay sharp. Fight smart.<br />
            — The PvP Scalpel Team
          </p>

          <p style="text-align: center; margin-top: 20px;">
              <a href="${frontEndDomain}" target="_blank" style="
                  color: #38bdf8;
                  text-decoration: none;
                  font-size: 13px;
              ">
                  🌐 Visit our website
              </a>
          </p>
        </div>
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