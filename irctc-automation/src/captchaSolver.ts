import { Page } from 'playwright';
import Tesseract from 'tesseract.js';
import path from 'path';
import fs from 'fs';

/** Absolute path to the tessdata directory bundled with the project */
const TESSDATA_PATH = path.resolve(__dirname, '..', 'tessdata');

/**
 * Captures the captcha image, runs Tesseract OCR, fills the input, clicks
 * the submit button, and retries automatically if IRCTC reports an
 * "Invalid Captcha" error.
 *
 * @param page               - Active Playwright page
 * @param captchaImgSelector - XPath/CSS selector for the captcha <img>
 * @param captchaInputSelector - XPath/CSS selector for the text input
 * @param submitSelector     - XPath/CSS selector for the button to click after filling
 * @param maxRetries         - Maximum OCR + submit attempts (default: 5)
 * @throws Error when all attempts are exhausted
 */
export async function solveCaptcha(
    page: Page,
    captchaImgSelector: string,
    captchaInputSelector: string,
    submitSelector: string,
    maxRetries = 5
): Promise<void> {
    let solved = false;
    let attempts = 0;

    while (!solved && attempts < maxRetries) {
        // 1. Wait for the captcha image to be present
        await page.waitForSelector(captchaImgSelector, { timeout: 5000 });
        const captchaElement = await page.$(captchaImgSelector);
        if (!captchaElement) {
            throw new Error('Captcha image element not found on the page.');
        }

        // 2. Screenshot the captcha to a temp file
        const captchaPath = path.resolve(__dirname, `captcha_tmp_${Date.now()}.png`);
        await captchaElement.screenshot({ path: captchaPath });

        // 3. OCR the screenshot with Tesseract
        const captchaBuffer = fs.readFileSync(captchaPath);
        const { data: { text } } = await Tesseract.recognize(captchaBuffer, 'eng', {
            langPath: TESSDATA_PATH,
        });

        // 4. Clean up the temp file immediately
        try { fs.unlinkSync(captchaPath); } catch { /* ignore */ }

        // 5. Strip all whitespace from OCR result
        const captchaText = text.replace(/\s/g, '').trim();
        console.log(`[Captcha] Attempt ${attempts + 1}/${maxRetries} → "${captchaText}"`);

        // 6. Fill and submit
        await page.fill(captchaInputSelector, captchaText);
        await page.waitForTimeout(200);
        await page.click(submitSelector);

        // 7. Check for IRCTC's "Invalid Captcha" toast/banner
        try {
            await page.waitForSelector('text=Invalid Captcha', { timeout: 2000 });
            console.warn('[Captcha] Invalid captcha reported by IRCTC, retrying…');
            attempts++;
            await page.fill(captchaInputSelector, '');
        } catch {
            // No error message found → captcha accepted
            solved = true;
        }
    }

    if (!solved) {
        throw new Error(`Failed to solve captcha after ${maxRetries} attempts.`);
    }

    console.log('[Captcha] Solved successfully.');
}
