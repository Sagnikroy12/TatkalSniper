import { chromium, Page } from 'playwright';
import { UserCredentials, LoginResponse } from './types';
import { selectTomorrow } from './datePicker';
import path from 'path';
import Tesseract from 'tesseract.js';
import SELECTORS from './selectors';
import fs from 'fs';

// Utility function to parse journey time from string format "HH:MM" to total minutes
function parseJourneyTime(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

async function loginToIRCTC(
    trainName: string,
    className: string,
    from: string,
    to: string,
    passengers?: any[],
    paymentDetails?: any
): Promise<LoginResponse> {
    // Parse credentials from process arguments
    const args = typeof process !== 'undefined' && process.argv ? require('minimist')(process.argv.slice(2)) : {};
    const username = args.username || '';
    const password = args.password || '';

    // Connect to the running Chrome instance
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    // Always create a new context with viewport: null to maximize window
    const context = await browser.newContext({ viewport: null });

    // Always open a new window and a new tab for IRCTC
    const page = await context.newPage();
    await page.goto('https://www.irctc.co.in/nget/train-search');

    // Maximize window if needed
    try {
        const session = await context.newCDPSession(page);
        await session.send('Browser.setWindowBounds', {
            windowId: (await session.send('Browser.getWindowForTarget')).windowId,
            bounds: { windowState: 'maximized' }
        });
    } catch (e) {
        console.warn('Could not maximize window via CDP:', (e as Error).message);
    }

    // Close any blank/newtab windows that may have opened
    const allPages = context.pages();
    for (const p of allPages) {
        if (p !== page && (p.url() === 'chrome://newtab/' || p.url() === 'about:blank')) {
            await p.close();
        }
    }

    await page.waitForSelector(SELECTORS.OK_BUTTON, { state: 'visible', timeout: 10000 });
    await page.click(SELECTORS.OK_BUTTON, { force: true });

    await page.waitForSelector(SELECTORS.THREE_DASH, { state: 'visible', timeout: 10000 });
    await page.click(SELECTORS.THREE_DASH, { force: true });

    // Wait for the login button to be visible (user must click it manually)
    await page.waitForSelector(SELECTORS.LOGIN, { timeout: 500 });
    await page.click(SELECTORS.LOGIN, { force: true });

    // Use credentials from arguments
    await page.type(SELECTORS.USERNAME, username, { delay: 100 });
    await page.type(SELECTORS.PASSWORD, password, { delay: 100 });

    // --- Solve captcha and click continue ---
    let loginCaptchaSolved = false;
    let loginRetryCount = 0;
    const loginMaxRetries = 5;

    while (!loginCaptchaSolved && loginRetryCount < loginMaxRetries) {
        await page.waitForSelector(SELECTORS.CAPTCHA_IMAGE, { timeout: 5000 });
        const captchaElement = await page.$(SELECTORS.CAPTCHA_IMAGE);
        if (!captchaElement) {
            throw new Error('Captcha image element not found!');
        }
        const captchaPath = path.resolve(__dirname, `captcha_login_${Date.now()}.png`);
        await captchaElement.screenshot({ path: captchaPath });
        console.log('Captcha screenshot saved at:', captchaPath);

        const captchaBuffer = fs.readFileSync(captchaPath);
        const { data: { text: captchaTextRawLogin } } = await Tesseract.recognize(captchaBuffer, 'eng', {
            // logger: m => console.log(m),
            langPath: path.resolve(__dirname, '../tessdata')
        });
        const captchaText = captchaTextRawLogin.replace(/\s/g, '').trim();
        console.log('Login captcha:', captchaText);

        await page.fill(SELECTORS.CAPTCHA_SOLVED, captchaText);
        await page.waitForTimeout(200);

        await page.click(SELECTORS.SIGN_IN);

        // Wait for a possible invalid captcha error message (adjust selector as needed)
        try {
            await page.waitForSelector('text=Invalid Captcha', { timeout: 2000 });
            console.log('Invalid login captcha detected, retrying...');
            loginRetryCount++;
            await page.fill(SELECTORS.CAPTCHA_SOLVED, '');
        } catch {
            // No invalid captcha message found, assume success
            loginCaptchaSolved = true;
        }
    }

    if (!loginCaptchaSolved) {
        throw new Error('Failed to solve login captcha after 5 attempts.');
    }
    // --- End of captcha block ---

    // Now wait for the "Last Transaction" element (login success)
    // await page.waitForSelector('(//*[contains(text()," Last Transaction Detail ")])[1]', { timeout: 30000 });

    const response: LoginResponse = {
        success: page.url() !== SELECTORS.URL,
        message: page.url() !== SELECTORS.URL ? 'Login successful' : 'Login failed',
    };

    // Fill FROM
    console.log('Filling FROM:', from);
    await page.fill(SELECTORS.FROM, '');
    await page.fill(SELECTORS.FROM, from);
    await page.waitForSelector("//span[contains(@class, 'disable-selection') and contains(text(), 'Stations')]", { timeout: 3000 });
    const firstStationOption = await page.$("//span[contains(@class, 'disable-selection') and contains(text(), 'Stations')]/ancestor::li/following-sibling::li[1]");
    if (firstStationOption) {
        await firstStationOption.click();
    } else {
        throw new Error("No station option found after the separator!");
    }
    await page.locator(SELECTORS.FROM).evaluate(e => e.blur());

    // Fill TO
    console.log('Filling TO:', to);
    await page.fill(SELECTORS.TO, '');
    await page.fill(SELECTORS.TO, to);
    await page.waitForSelector('//ul[@role="listbox"]/li[1]', { timeout: 3000 });
    await page.click('//ul[@role="listbox"]/li[1]');
    await page.locator(SELECTORS.TO).evaluate(e => e.blur());
    await selectTomorrow(page);

    await page.click(SELECTORS.CLASS);
    await page.click(`//*[contains(text(), "${className}")]`);
    await page.click(SELECTORS.TYPE);
    await page.click('//*[contains(text(), "PREMIUM TATKAL")]');
    await page.waitForSelector(SELECTORS.SEARCH, { timeout: 2000 });
    await page.click(SELECTORS.SEARCH);

    await page.waitForSelector('//div[contains(@class,"train-heading")]', { timeout: 5000 });
    const trainNameElements = await page.$$('//div[contains(@class,"train-heading")]');
    let trainIndex = -1;
    const userTrain = trainName.trim().toUpperCase();
    for (let i = 0; i < trainNameElements.length; i++) {
        const name = (await trainNameElements[i].textContent())?.trim().toUpperCase() || '';
        if (name.includes(userTrain) || userTrain.includes(name)) {
            trainIndex = i + 1; // XPath is 1-based
            break;
        }
    } 
    
    if (trainIndex === -1) {
        throw new Error('Train not found!');
    }

    const trainRowXPath = `(//*[contains(@class,'form-group')])[${trainIndex+1}]`;

    // Select class and check availability as before
    await page.click(`${trainRowXPath}//strong[contains(text(), "${className}")]`);
    await page.click('//*[contains(text(),"AVAILABLE")]');

    // Wait for the "Book Now" button to be enabled and visible
    const bookNowSelector = `${trainRowXPath}//*[contains(text(), "Book Now")]`;
    await page.waitForSelector(bookNowSelector, { state: 'visible', timeout: 30000 });

    console.log('10:00 AM IST reached and "Book Now" is enabled. Clicking...');
    await page.click(bookNowSelector);
    try {
        await page.waitForSelector(SELECTORS.NO, { timeout: 3000 });
        await page.click(SELECTORS.NO);
        console.log('"NO" dialog detected and clicked.');

        // Get all fallback train containers
        const fallbackTrains = await page.$$(SELECTORS.FALLBACK_TRAIN);

        let bestTrainIndex = -1;
        let lowestJourneyTime = Infinity;

        for (let i = 0; i < fallbackTrains.length; i++) {
            // Find journey time element inside this fallback train
            const journeyTimeElement = await fallbackTrains[i].$(
                './/span[contains(@class,"col-xs-3 pull-left line-hr")]/span[contains(text(), ":")]'
            );
            if (journeyTimeElement) {
                const timeText = (await journeyTimeElement.textContent())?.trim() || '';
                if (/^\d{1,2}:[0-5]\d$/.test(timeText)) {
                    const minutes = parseJourneyTime(timeText);
                    if (minutes < lowestJourneyTime) {
                        lowestJourneyTime = minutes;
                        bestTrainIndex = i;
                    }
                }
            }
            
        }

        if (bestTrainIndex !== -1) {
            // Click on the best fallback train (lowest journey time)
            await fallbackTrains[bestTrainIndex].click();
            console.log(`Selected fallback train at index ${bestTrainIndex} with journey time ${lowestJourneyTime} minutes.`);
            // Continue with booking logic for this train...
        } else {
            throw new Error('No suitable fallback train found with a valid journey time.');
        }
    } catch (e: any) {
        console.log('NO dialog not detected or no fallback train needed:', e.message);
    }

    // passengers is an array of objects: [{name, age, gender}, ...]
    const safePassengers = passengers ?? [];
    for (let i = 0; i < safePassengers.length; i++) {
        const passenger = safePassengers[i];

        // Wait for the Name field to be present
        await page.waitForSelector(`(${SELECTORS.NAME})[${i + 1}]`, { timeout: 2000 });

        // Fill Name
        await page.fill(`(${SELECTORS.NAME})[${i + 1}]`, passenger.name);

        // Wait for Age field
        await page.waitForSelector(`(${SELECTORS.AGE})[${i + 1}]`, { timeout: 2000 });
        await page.fill(`(${SELECTORS.AGE})[${i + 1}]`, passenger.age);

        // Wait for Gender field
        await page.waitForSelector(`(${SELECTORS.GENDER})[${i + 1}]`, { timeout: 2000 });

        // Select Gender
        let genderValue = '';
        if (passenger.gender === 'M') genderValue = 'Male';
        else if (passenger.gender === 'F') genderValue = 'Female';
        else if (passenger.gender === 'O') genderValue = 'Transgender';
        await page.selectOption(`(${SELECTORS.GENDER})[${i + 1}]`, { label: genderValue });

        // If more passengers to add, click "Add Passenger"
        if (i < safePassengers.length - 1) {
            await page.click(SELECTORS.ADD_PASSENGER);
        }
    }

    await page.click(SELECTORS.CONTINUE2);

    let captchaSolved = false;
    let retryCount = 0;
    const maxRetries = 5;

    while (!captchaSolved && retryCount < maxRetries) {
        // Solve captcha using Tesseract before clicking CONTINUE
        await page.waitForSelector(SELECTORS.CAPTCHA_IMAGE, { timeout: 5000 });
        const captchaElement2 = await page.$(SELECTORS.CAPTCHA_IMAGE);
        if (!captchaElement2) {
            throw new Error('Captcha image element not found!');
        }

        // Always save the captcha screenshot for debugging
        const captchaPath2 = path.resolve(__dirname, `captcha_${Date.now()}.png`);
        await captchaElement2.screenshot({ path: captchaPath2 });
        console.log('Captcha screenshot saved at:', captchaPath2);

        // Use the saved screenshot file for Tesseract
        const captchaBuffer2 = fs.readFileSync(captchaPath2);

        const { data: { text: captchaTextRaw } } = await Tesseract.recognize(captchaBuffer2, 'eng', {
            logger: m => console.log(m),
            langPath: path.join(__dirname, '..', 'tessdata')
        });
        // Accept all upper/lowercase letters, digits, and special characters (remove only whitespace)
        const captchaText2 = captchaTextRaw.replace(/\s/g, '').trim();
        console.log('Final captcha:', captchaText2);

        // Fill the captcha input
        await page.fill(SELECTORS.CAPTCHA_SOLVED, captchaText2);

        await page.click(SELECTORS.CONTINUE3);

        // Wait for a possible invalid captcha error message (adjust selector as needed)
        try {
            await page.waitForSelector('text=Invalid Captcha', { timeout: 2000 });
            console.log('Invalid captcha detected, retrying...');
            retryCount++;
            // Optionally, clear the captcha input if needed
            await page.fill(SELECTORS.CAPTCHA_SOLVED, '');
        } catch {
            // No invalid captcha message found, assume success
            captchaSolved = true;
        }
    }

    if (!captchaSolved) {
        throw new Error('Failed to solve captcha after 5 attempts.');
    }

    await page.click(SELECTORS.PAY_BOOK);

    // Assume payment details are passed as a JSON string via --payment argument
    const paymentArgs = typeof process !== 'undefined' && process.argv ? require('minimist')(process.argv.slice(2)) : {};
    const paymentDetailsFromArgs = paymentArgs.payment ? JSON.parse(paymentArgs.payment) : null;

    if (paymentDetailsFromArgs) {
        // Click on the payment method tab
        if (paymentDetailsFromArgs.method === "Credit Card") {
            await page.click(SELECTORS.CREDIT_CARD);

            await page.fill(SELECTORS.CARD_NUMBER, paymentDetailsFromArgs.card_number);
            await page.fill(SELECTORS.VALID_THRU, paymentDetailsFromArgs.valid_thru);
            await page.fill(SELECTORS.CVV, paymentDetailsFromArgs.cvv);
            await page.fill(SELECTORS.CARD_HOLDER_NAME, paymentDetailsFromArgs.card_name);
        } else if (paymentDetailsFromArgs.method === "Debit Card") {
            await page.click(SELECTORS.DEBIT_CARD);

            await page.fill(SELECTORS.CARD_NUMBER, paymentDetailsFromArgs.card_number);
            await page.fill(SELECTORS.VALID_THRU, paymentDetailsFromArgs.valid_thru);
            await page.fill(SELECTORS.CVV, paymentDetailsFromArgs.cvv);
            await page.fill(SELECTORS.CARD_HOLDER_NAME, paymentDetailsFromArgs.card_name);
        } else if (paymentDetailsFromArgs.method === "UPI") {
            await page.click(SELECTORS.UPI);

            await page.fill(SELECTORS.UPI_ID, paymentDetailsFromArgs.upi_id);
        }
    }
    await page.click(SELECTORS.PAY);

    return response;
}

// Accept arguments from the GUI via command line
if (require.main === module) {
    // npm install minimist
    const args = require('minimist')(process.argv.slice(2));
    const from = args.from || '';
    const to = args.to || '';
    const trainName = args.train || '';
    const className = args.class || '';
    const passengers = args.passengers ? JSON.parse(args.passengers) : [];
    const paymentDetails = args.payment ? JSON.parse(args.payment) : undefined;

    console.log('FROM:', from, 'TO:', to);

    loginToIRCTC(trainName, className, from, to, passengers, paymentDetails)
        .then(res => {
            console.log(res);
        })
        .catch(err => {
            console.error('Automation failed:', err);
        });
}

export { loginToIRCTC };

