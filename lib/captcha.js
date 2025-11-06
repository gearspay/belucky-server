const fetch = require("node-fetch");

const API_KEY = process.env.CAPTCHA_API_KEY; // put your key here

/**
 * Solve captcha with 2Captcha
 * @param {string} base64Captcha - Base64 string of the captcha image
 * @param {number} timeout - Max time to wait (in minutes)
 * @returns {Promise<string>} - Captcha solution
 */
async function Captcha(base64Captcha, timeout = 5) {
    const formData = new URLSearchParams();
    formData.append("key", API_KEY);
    formData.append("method", "base64");
    formData.append("body", base64Captcha);

    // 1. Upload captcha
    const res = await fetch("http://2captcha.com/in.php", {
        method: "POST",
        body: formData,
    });
    const text = await res.text();

    if (!text.startsWith("OK|")) {
        throw new Error("Error sending captcha: " + text);
    }

    const captchaId = text.split("|")[1];

    // 2. Poll result
    const endTime = Date.now() + timeout * 60 * 1000;

    while (Date.now() < endTime) {
        await new Promise(r => setTimeout(r, 5000));

        const res2 = await fetch(
            `http://2captcha.com/res.php?key=${API_KEY}&action=get&id=${captchaId}`
        );
        const result = await res2.text();

        if (result === "CAPCHA_NOT_READY") continue;

        if (result.startsWith("OK|")) {
            return result.split("|")[1];
        } else {
            throw new Error("Error solving captcha: " + result);
        }
    }

    throw new Error("Captcha solve timeout");
}

module.exports = Captcha;



