import { Resend } from "resend";
import dotenv from 'dotenv'
import path from 'path';
import { fileURLToPath } from 'url';

const _filename = fileURLToPath(import.meta.url);
const dir = path.dirname(_filename);

dotenv.config({path: `${dir}/.env`});

const apiKey = process.env.RESEND_API_KEY;
const resend = new Resend(apiKey);

const frontEndDomain = "https://www.pvpscalpel.com/";

const mail = {
    sendJWTAuth : async function (email, code, option) {
        const passwoardLink = frontEndDomain + `reset/password?token=${code}`;
        
        let header;
        let html;
        switch (option) {
            case "email" :
                header = "Email Address verification";
                html = `
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
                            Thank you for being part of <strong>PvP Scalpel</strong>.<br />
                            Please use the following 6-digit code to verify your ${header}:
                        </p>

                        <div style="
                            text-align: center;
                            margin: 30px 0;
                            font-size: 32px;
                            letter-spacing: 10px;
                            font-weight: bold;
                            background: #1f2937;
                            padding: 16px;
                            border-radius: 8px;
                            display: inline-block;
                        ">
                            ${code}
                        </div>

                        <p style="font-size: 14px; color: #9ca3af;">
                            If you didn’t submitted a request, you can ignore this email.
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

                `; break;
            case "password": 
            header = `Reset password`
            html = `
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
                    <h2 style="color: #38bdf8;">🔒 Password Reset</h2>
                    <p style="line-height: 1.6; color: #9ca3af;">
                        Thank you for registering at <strong>PvP Scalpel</strong>.<br />
                        Please click the button below to reset your password:
                    </p>
                
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${passwoardLink}" target="_blank" style="
                        background: #38bdf8;
                        color: #000;
                        padding: 12px 24px;
                        text-decoration: none;
                        font-weight: bold;
                        border-radius: 6px;
                        display: inline-block;
                        ">Reset Password</a>
                    </div>
                
                    <p style="font-size: 14px; color: #9ca3af;">
                        If you didn’t made that request, please ignore this email.
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
      `; break;
            default: console.warn(`Allowed options are :\nemail\npassword`); return undefined;
        }

        await resend.emails.send({
            from: 'noreply@pvpscalpel.com',
            to: email,
            subject: header,
            html: html,
        })
    }
}

export default mail;

// Test run with the next line (uncomment it)
// mail.sendJWTAuth(`l.stanev2000@gmail.com`, `TEST`, "email")