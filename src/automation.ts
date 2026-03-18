<<<<<<< HEAD
import { chromium } from "playwright";
import path from "path";
import Tesseract from "tesseract.js";
import fs from "fs";

import { UserCredentials, LoginResponse } from "./types";
import { selectTomorrow } from "./datePicker";
import SELECTORS from "./selectors";

const TESSDATA_PATH = path.join(__dirname, "..", "tessdata");

function parseJourneyTime(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

// async function solveCaptcha(imagePath: string): Promise<string> {
//   const buffer = fs.readFileSync(imagePath);
//   const {
//     data: { text },
//   } = await Tesseract.recognize(buffer, "eng", {
//     langPath: TESSDATA_PATH,
//   });
//   return text.replace(/\s/g, "").trim();
// }

async function solveCaptcha(imagePath: string): Promise<string> {
  const waitUntilExists = async (maxWait = 3000) => {
    const start = Date.now();
    while (!fs.existsSync(imagePath)) {
      if (Date.now() - start > maxWait) {
        throw new Error(`CAPTCHA file did not appear within ${maxWait}ms: ${imagePath}`);
      }
      await new Promise((res) => setTimeout(res, 100));
    }
  };

  // Safety delay to let screenshot fully flush to disk
  await new Promise((res) => setTimeout(res, 300));

  await waitUntilExists(); // Retry loop until file appears

  const buffer = fs.readFileSync(imagePath);
  const {
    data: { text },
  } = await Tesseract.recognize(buffer, "eng", {
    langPath: TESSDATA_PATH,
  });

//   fs.unlinkSync(imagePath); // 💥 delete image after use
  return text.replace(/\s/g, "").trim();
}


async function loginToIRCTC(
  trainName: string,
  className: string,
  from: string,
  to: string,
  passengers?: any[],
  paymentDetails?: any
): Promise<LoginResponse> {
  const args = require("minimist")(process.argv.slice(2));
  const username = args.username || "";
  const password = args.password || "";

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const allContexts = await browser.contexts();
  const context =
    allContexts.length > 0
      ? allContexts[0]
      : await browser.newContext({ viewport: null });
  const allPages = context.pages();
  const page = allPages.length > 0 ? allPages[0] : await context.newPage();

  await page.goto("https://www.irctc.co.in/nget/train-search");

  try {
    const session = await context.newCDPSession(page);
    await session.send("Browser.setWindowBounds", {
      windowId: (await session.send("Browser.getWindowForTarget")).windowId,
      bounds: { windowState: "maximized" },
    });
  } catch (e) {
    console.warn("Could not maximize window via CDP:", (e as Error).message);
  }

  await page.waitForSelector(SELECTORS.OK_BUTTON, { timeout: 10000 });
  await page.click(SELECTORS.OK_BUTTON, { force: true });
  await page.click(SELECTORS.THREE_DASH, { force: true });
  await page.click(SELECTORS.LOGIN, { force: true });

  await page.type(SELECTORS.USERNAME, username, { delay: 100 });
  await page.type(SELECTORS.PASSWORD, password, { delay: 100 });

  for (let i = 0; i < 5; i++) {
    const captchaElement = await page.$(SELECTORS.CAPTCHA_IMAGE);
    const captchaPath = path.resolve(
      __dirname,
      `captcha_login_${Date.now()}.png`
    );
    await captchaElement?.screenshot({ path: captchaPath });
    const captchaText = await solveCaptcha(captchaPath);

    console.log("Login captcha:", captchaText);
    await page.type(SELECTORS.CAPTCHA_SOLVED, captchaText, { delay: 100 });
    await page.waitForTimeout(200);
    await page.click(SELECTORS.SIGN_IN);

    try {
      await page.waitForSelector("text=Invalid Captcha", { timeout: 2000 });
      console.log("Invalid login captcha detected, retrying...");
      await page.type(SELECTORS.CAPTCHA_SOLVED, "");
    } catch {
      break;
    }
    // fs.unlinkSync(captchaPath);
  }

  const response: LoginResponse = {
    success: page.url() !== SELECTORS.URL,
    message: page.url() !== SELECTORS.URL ? "Login successful" : "Login failed",
  };

  console.log("Filling FROM:", from);
  await page.type(SELECTORS.FROM, "");
  await page.type(SELECTORS.FROM, from);
  await page.waitForSelector(
    "//span[contains(@class, 'disable-selection') and contains(text(), 'Stations')]",
    { timeout: 3000 }
  );
  const firstStationOption = await page.$(
    "//span[contains(@class, 'disable-selection') and contains(text(), 'Stations')]/ancestor::li/following-sibling::li[1]"
  );
  if (firstStationOption) {
    await firstStationOption.click();
  } else {
    throw new Error("No station option found after the separator!");
  }
  await page.locator(SELECTORS.FROM).evaluate((e) => e.blur());

  console.log("Filling TO:", to);
  await page.type(SELECTORS.TO, to);
  await page.click('//ul[@role="listbox"]/li[1]');
  await selectTomorrow(page);
  console.log("Date selected");
  await page.click(SELECTORS.TYPE);
  await page.click('//*[contains(text(), "PREMIUM TATKAL")]');
  await page.click(SELECTORS.SEARCH);

  await page.waitForSelector('//div[contains(@class,"train-heading")]', {
    timeout: 5000,
  });
  const trainElements = await page.$$(
    '//div[contains(@class,"train-heading")]'
  );
  const trainTimes = await page.$$eval(
    '//div[contains(@class,"train-heading")]/following-sibling::div//div[contains(@class,"time")]//strong',
    (nodes) => nodes.map((n) => n.textContent?.trim() || "")
  );

  interface TrainCandidate {
    index: number;
    name: string;
    journeyTime: number;
  }

  const userTrain = trainName.trim().toUpperCase();
  let fallbackTrain: TrainCandidate | null = null;

  for (let i = 0; i < trainElements.length; i++) {
    const el = trainElements[i];
    const name = (await el.textContent())?.trim().toUpperCase() || "";
    const time = parseJourneyTime(trainTimes[i] || "99:59");

    if (name.includes(userTrain) || userTrain.includes(name)) {
      fallbackTrain = { index: i, name, journeyTime: time };
      break;
    }

    if (!fallbackTrain || time < fallbackTrain.journeyTime) {
      fallbackTrain = { index: i, name, journeyTime: time };
    }
  }

  if (!fallbackTrain) throw new Error("No trains found");

  let selected = false;
  while (!selected && fallbackTrain) {
    const trainRowXPath = `(//*[contains(@class,'form-group')])[${
      fallbackTrain.index + 2
    }]`;

    try {
      await page.click(
        `${trainRowXPath}//strong[contains(text(), "${className}")]`
      );
      await page.click(`${trainRowXPath}//*[contains(text(),"AVAILABLE")]`);

      const bookNowSelector = `${trainRowXPath}//*[contains(text(), "Book Now")]`;
      await page.waitForSelector(bookNowSelector, { timeout: 30000 });
      await page.click(bookNowSelector);
      selected = true;
    } catch (e) {
      console.log(`Train ${fallbackTrain.name} not available or failed:`, e);
      fallbackTrain = null;
    }
  }

  if (!selected) throw new Error("No available train found with desired class");

  try {
    await page.click(SELECTORS.NO);
    console.log('"NO" dialog clicked');
  } catch {}

  let parsedPassengers: any[] = [];
  try {
    parsedPassengers = args.passengers ? JSON.parse(args.passengers) : [];
    parsedPassengers = Array.isArray(parsedPassengers)
      ? parsedPassengers.filter((p) => p && p.name)
      : [];
  } catch (err) {
    console.error("Invalid passengers JSON passed:", err);
  }

//   await page.waitForSelector(SELECTORS.NAME);
//   for (let i = 0; i < parsedPassengers.length; i++) {
//     const passenger = parsedPassengers[i];
//     if (!passenger) continue;

//     await page.type(`(${SELECTORS.NAME})[${i + 1}]`, passenger.name);
//     await page.type(`(${SELECTORS.AGE})[${i + 1}]`, passenger.age);

//     const genderLabel =
//       passenger.gender === "M"
//         ? "Male"
//         : passenger.gender === "F"
//         ? "Female"
//         : "Transgender";

//     await page.selectOption(`(${SELECTORS.GENDER})[${i + 1}]`, {
//       label: genderLabel,
//     });

//     if (i < parsedPassengers.length - 1) {
//       await page.click(SELECTORS.ADD_PASSENGER);
//     }
//   }
const safePassengers = passengers ?? [];
    for (let i = 0; i < safePassengers.length; i++) {
        const passenger = safePassengers[i];

        // Wait for the Name field to be present
        await page.waitForSelector(`(${SELECTORS.NAME})[${i + 1}]`, { timeout: 2000 }); // reduced

        // Fill Name
        await page.fill(`(${SELECTORS.NAME})[${i + 1}]`, passenger.name);

        // Wait for Age field
        await page.waitForSelector(`(${SELECTORS.AGE})[${i + 1}]`, { timeout: 2000 }); // reduced
        await page.fill(`(${SELECTORS.AGE})[${i + 1}]`, passenger.age);

        // Wait for Gender field
        await page.waitForSelector(`(${SELECTORS.GENDER})[${i + 1}]`, { timeout: 2000 }); // reduced

        // Select Gender
        let genderValue = '';
        if (passenger.gender === 'M') genderValue = 'Male';
        else if (passenger.gender === 'F') genderValue = 'Female';
        else if (passenger.gender === 'O') genderValue = 'Transgender';
        await page.selectOption(`(${SELECTORS.GENDER})[${i + 1}]`, { label: genderValue });

        // If more passengers to add, click "Add Passenger"
        if (i < safePassengers.length - 1) {
=======
import { chromium } from 'playwright';
import { LoginResponse, Passenger, PaymentDetails, CliArgs } from './types';
import { selectTomorrow } from './datePicker';
import { solveCaptcha } from './captchaSolver';
import SELECTORS from './selectors';
import path from 'path';
import minimist from 'minimist';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parses a journey-time string in "HH:MM" format into total minutes.
 * Used to select the fastest fallback train.
 */
function parseJourneyTime(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

// ─── Main Booking Function ────────────────────────────────────────────────────

/**
 * Orchestrates the full IRCTC Tatkal booking flow:
 *   1. Connects to an already-running Chrome instance via CDP
 *   2. Logs in using provided credentials
 *   3. Searches for the train and selects Premium Tatkal class
 *   4. Fills passenger details
 *   5. Solves captchas (login + booking) via Tesseract OCR
 *   6. Completes payment
 *
 * @param trainName      - Full or partial train name to search for
 * @param className      - Travel class (e.g. "3A", "SL", "CC")
 * @param from           - Origin station code (e.g. "NDLS")
 * @param to             - Destination station code (e.g. "MMCT")
 * @param credentials    - IRCTC username and password
 * @param passengers     - List of passenger objects
 * @param paymentDetails - Payment method and associated details
 * @returns LoginResponse indicating success or failure
 */
async function bookTatkalTicket(
    trainName: string,
    className: string,
    from: string,
    to: string,
    credentials: { username: string; password: string },
    passengers: Passenger[],
    paymentDetails: PaymentDetails
): Promise<LoginResponse> {

    // ── 1. Browser Setup ───────────────────────────────────────────────────────
    // Connect to the running Chrome instance (started by the GUI with --remote-debugging-port)
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    await page.goto('https://www.irctc.co.in/nget/train-search');

    // Maximise window via CDP
    try {
        const session = await context.newCDPSession(page);
        const { windowId } = await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'maximized' },
        });
    } catch (e) {
        console.warn('[Setup] Could not maximise window via CDP:', (e as Error).message);
    }

    // Close any stray blank tabs that Chrome may have opened
    for (const p of context.pages()) {
        if (p !== page && ['chrome://newtab/', 'about:blank'].includes(p.url())) {
            await p.close();
        }
    }

    // ── 2. Navigation to Login ─────────────────────────────────────────────────
    await page.waitForSelector(SELECTORS.OK_BUTTON, { state: 'visible', timeout: 10000 });
    await page.click(SELECTORS.OK_BUTTON, { force: true });

    await page.waitForSelector(SELECTORS.THREE_DASH, { state: 'visible', timeout: 10000 });
    await page.click(SELECTORS.THREE_DASH, { force: true });

    await page.waitForSelector(SELECTORS.LOGIN, { timeout: 5000 });
    await page.click(SELECTORS.LOGIN, { force: true });

    // ── 3. Fill Credentials ────────────────────────────────────────────────────
    await page.type(SELECTORS.USERNAME, credentials.username, { delay: 80 });
    await page.type(SELECTORS.PASSWORD, credentials.password, { delay: 80 });

    // ── 4. Solve Login Captcha ─────────────────────────────────────────────────
    console.log('[Login] Solving login captcha…');
    await solveCaptcha(
        page,
        SELECTORS.CAPTCHA_IMAGE,
        SELECTORS.CAPTCHA_INPUT,
        SELECTORS.SIGN_IN
    );

    // ── 5. Detect Login Success ────────────────────────────────────────────────
    const response: LoginResponse = {
        success: page.url() !== SELECTORS.URL,
        message: page.url() !== SELECTORS.URL ? 'Login successful' : 'Login failed',
    };
    console.log(`[Login] ${response.message}`);

    // ── 6. Fill Train Search Form ──────────────────────────────────────────────
    console.log(`[Search] FROM: ${from}  TO: ${to}`);

    // From station
    await page.fill(SELECTORS.FROM, '');
    await page.fill(SELECTORS.FROM, from);
    await page.waitForSelector(
        "//span[contains(@class,'disable-selection') and contains(text(),'Stations')]",
        { timeout: 3000 }
    );
    const fromOption = await page.$(
        "//span[contains(@class,'disable-selection') and contains(text(),'Stations')]" +
        "/ancestor::li/following-sibling::li[1]"
    );
    if (!fromOption) throw new Error('No FROM station option found in suggestions.');
    await fromOption.click();
    await page.locator(SELECTORS.FROM).evaluate((el) => el.blur());

    // To station
    await page.fill(SELECTORS.TO, '');
    await page.fill(SELECTORS.TO, to);
    await page.waitForSelector('//ul[@role="listbox"]/li[1]', { timeout: 3000 });
    await page.click('//ul[@role="listbox"]/li[1]');
    await page.locator(SELECTORS.TO).evaluate((el) => el.blur());

    // Select tomorrow's date
    await selectTomorrow(page);

    // Journey class
    await page.click(SELECTORS.CLASS);
    await page.click(`//*[contains(text(), "${className}")]`);

    // Quota: Premium Tatkal
    await page.click(SELECTORS.TYPE);
    await page.click('//*[contains(text(), "PREMIUM TATKAL")]');

    // Search
    await page.waitForSelector(SELECTORS.SEARCH, { timeout: 2000 });
    await page.click(SELECTORS.SEARCH);

    // ── 7. Select Train ────────────────────────────────────────────────────────
    await page.waitForSelector('//div[contains(@class,"train-heading")]', { timeout: 10000 });
    const trainHeadings = await page.$$('//div[contains(@class,"train-heading")]');

    let trainIndex = -1;
    const normalizedInput = trainName.trim().toUpperCase();

    for (let i = 0; i < trainHeadings.length; i++) {
        const name = (await trainHeadings[i].textContent())?.trim().toUpperCase() ?? '';
        if (name.includes(normalizedInput) || normalizedInput.includes(name)) {
            trainIndex = i + 1; // XPath positions are 1-based
            break;
        }
    }

    if (trainIndex === -1) {
        throw new Error(`Train "${trainName}" not found in search results.`);
    }

    // XPath context for the matched train's row
    const trainRowXPath = `(//*[contains(@class,'form-group')])[${trainIndex + 1}]`;

    // ── 8. Select Class & Availability ────────────────────────────────────────
    await page.click(`${trainRowXPath}//strong[contains(text(), "${className}")]`);
    await page.click('//*[contains(text(),"AVAILABLE")]');

    // ── 9. Click "Book Now" ────────────────────────────────────────────────────
    const bookNowSelector = `${trainRowXPath}//*[contains(text(), "Book Now")]`;
    await page.waitForSelector(bookNowSelector, { state: 'visible', timeout: 30000 });
    console.log('[Booking] "Book Now" button is visible. Clicking…');
    await page.click(bookNowSelector);

    // Handle optional "would you like to choose an alternate train?" dialog
    try {
        await page.waitForSelector(SELECTORS.NO, { timeout: 3000 });
        await page.click(SELECTORS.NO);
        console.log('[Booking] Alternate-train dialog dismissed.');

        // Pick the fastest among any offered fallback trains
        const fallbackTrains = await page.$$(SELECTORS.FALLBACK_TRAIN);
        let bestIndex = -1;
        let lowestTime = Infinity;

        for (let i = 0; i < fallbackTrains.length; i++) {
            const timeEl = await fallbackTrains[i].$(
                './/span[contains(@class,"col-xs-3 pull-left line-hr")]' +
                '/span[contains(text(), ":")]'
            );
            if (timeEl) {
                const timeText = (await timeEl.textContent())?.trim() ?? '';
                if (/^\d{1,2}:[0-5]\d$/.test(timeText)) {
                    const minutes = parseJourneyTime(timeText);
                    if (minutes < lowestTime) {
                        lowestTime = minutes;
                        bestIndex = i;
                    }
                }
            }
        }

        if (bestIndex === -1) {
            throw new Error('No fallback train with a parseable journey time found.');
        }
        await fallbackTrains[bestIndex].click();
        console.log(
            `[Booking] Selected fallback train #${bestIndex} (journey: ${lowestTime} min).`
        );
    } catch (e: unknown) {
        // Dialog not present – proceed with the originally selected train
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[Booking] No alternate-train dialog: ${msg}`);
    }

    // ── 10. Fill Passenger Details ─────────────────────────────────────────────
    for (let i = 0; i < passengers.length; i++) {
        const { name, age, gender } = passengers[i];

        await page.waitForSelector(`(${SELECTORS.NAME})[${i + 1}]`, { timeout: 3000 });
        await page.fill(`(${SELECTORS.NAME})[${i + 1}]`, name);

        await page.waitForSelector(`(${SELECTORS.AGE})[${i + 1}]`, { timeout: 3000 });
        await page.fill(`(${SELECTORS.AGE})[${i + 1}]`, age);

        await page.waitForSelector(`(${SELECTORS.GENDER})[${i + 1}]`, { timeout: 3000 });
        const genderLabel = gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : 'Transgender';
        await page.selectOption(`(${SELECTORS.GENDER})[${i + 1}]`, { label: genderLabel });

        if (i < passengers.length - 1) {
>>>>>>> refactor-done
            await page.click(SELECTORS.ADD_PASSENGER);
        }
    }

<<<<<<< HEAD
  await page.click(SELECTORS.CONTINUE2);

  //   for (let i = 0; i < 5; i++) {
  //     const captchaPath = path.resolve(__dirname, `captcha_${Date.now()}.png`);
  //     // await (
  //     //   await page.$(SELECTORS.CAPTCHA_IMAGE)
  //     // )?.screenshot({ path: captchaPath });
  //     // const captchaText = await solveCaptcha(captchaPath);
  //     const captchaElement = await page.$(SELECTORS.CAPTCHA_IMAGE);
  //     if (!captchaElement) throw new Error("CAPTCHA element not found");

  //     await captchaElement.screenshot({ path: captchaPath });

  //     // Ensure file is written before reading
  //     await new Promise((resolve) => setTimeout(resolve, 500));

  //     if (!fs.existsSync(captchaPath)) {
  //       throw new Error("CAPTCHA screenshot file not found after saving");
  //     }

  //     const captchaText = await solveCaptcha(captchaPath);

  //     console.log("Final captcha:", captchaText);

  //     await page.type(SELECTORS.CAPTCHA_SOLVED, captchaText);
  //     await page.click(SELECTORS.CONTINUE3);

  //     try {
  //       await page.waitForSelector("text=Invalid Captcha", { timeout: 2000 });
  //       console.log("Invalid final captcha, retrying...");
  //       await page.type(SELECTORS.CAPTCHA_SOLVED, "");
  //     } catch {
  //       break;
  //     }
  //   }

//   for (let i = 0; i < 5; i++) {
//     const captchaElement = await page.$(SELECTORS.CAPTCHA_IMAGE);
//     const captchaPath = path.resolve(
//       __dirname,
//       `captcha_login_${Date.now()}.png`
//     );
//     await captchaElement?.screenshot({ path: captchaPath });
//     const captchaText = await solveCaptcha(captchaPath);
    
//     console.log("Captcha:", captchaText);
//     await page.type(SELECTORS.CAPTCHA_SOLVED, captchaText, { delay: 100 });
//     await page.waitForTimeout(200);
//     await page.click(SELECTORS.SIGN_IN);

//     try {
//       await page.waitForSelector("text=Invalid Captcha", { timeout: 2000 });
//       console.log("Invalid login captcha detected, retrying...");
//       await page.type(SELECTORS.CAPTCHA_SOLVED, "");
//     } catch {
//       break;
//     }
//     // fs.unlinkSync(captchaPath);
//   }

let captchaSolved = false;
    let retryCount = 0;
    const maxRetries = 5;

    while (!captchaSolved && retryCount < maxRetries) {
        // Solve captcha using Tesseract before clicking CONTINUE
        await page.waitForSelector(SELECTORS.CAPTCHA_IMAGE, { timeout: 5000 }); // reduced
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
            langPath: path.resolve(__dirname, 'tessdata') // Make sure this is the directory, not the file
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

  const paymentArgs = args.payment ? JSON.parse(args.payment) : {};
  if (paymentArgs.method === "UPI") {
    await page.click(SELECTORS.UPI);
    await page.fill(SELECTORS.UPI_ID, paymentArgs.upi_id);
  } else if (
    paymentArgs.method === "Credit Card" ||
    paymentArgs.method === "Debit Card"
  ) {
    const cardSelector =
      paymentArgs.method === "Credit Card"
        ? SELECTORS.CREDIT_CARD
        : SELECTORS.DEBIT_CARD;
    await page.click(cardSelector);
    await page.fill(SELECTORS.CARD_NUMBER, paymentArgs.card_number);
    await page.fill(SELECTORS.VALID_THRU, paymentArgs.valid_thru);
    await page.fill(SELECTORS.CVV, paymentArgs.cvv);
    await page.fill(SELECTORS.CARD_HOLDER_NAME, paymentArgs.card_name);
  }

  await page.click(SELECTORS.PAY);
  return response;
}

if (require.main === module) {
  const args = require("minimist")(process.argv.slice(2));
  const from = args.from || "";
  const to = args.to || "";
  const trainName = args.train || "";
  const className = args.class || "";
  const passengers = args.passengers ? JSON.parse(args.passengers) : [];
  const paymentDetails = args.payment ? JSON.parse(args.payment) : undefined;

  console.log("FROM:", from, "TO:", to);

  loginToIRCTC(trainName, className, from, to, passengers, paymentDetails)
    .then((res) => console.log(res))
    .catch((err) => console.error("Automation failed:", err));
}

export { loginToIRCTC };
=======
    await page.click(SELECTORS.CONTINUE2);

    // ── 11. Solve Booking Captcha ──────────────────────────────────────────────
    console.log('[Booking] Solving booking captcha…');
    await solveCaptcha(
        page,
        SELECTORS.BOOKING_CAPTCHA_IMAGE,
        SELECTORS.BOOKING_CAPTCHA_INPUT,
        SELECTORS.CONTINUE3
    );

    // ── 12. Payment ────────────────────────────────────────────────────────────
    await page.click(SELECTORS.PAY_BOOK);

    switch (paymentDetails.method) {
        case 'Credit Card':
            await page.click(SELECTORS.CREDIT_CARD);
            await page.fill(SELECTORS.CARD_NUMBER,      paymentDetails.card_number ?? '');
            await page.fill(SELECTORS.VALID_THRU,       paymentDetails.valid_thru  ?? '');
            await page.fill(SELECTORS.CVV,              paymentDetails.cvv          ?? '');
            await page.fill(SELECTORS.CARD_HOLDER_NAME, paymentDetails.card_name   ?? '');
            break;

        case 'Debit Card':
            await page.click(SELECTORS.DEBIT_CARD);
            await page.fill(SELECTORS.CARD_NUMBER,      paymentDetails.card_number ?? '');
            await page.fill(SELECTORS.VALID_THRU,       paymentDetails.valid_thru  ?? '');
            await page.fill(SELECTORS.CVV,              paymentDetails.cvv          ?? '');
            await page.fill(SELECTORS.CARD_HOLDER_NAME, paymentDetails.card_name   ?? '');
            break;

        case 'UPI':
            await page.click(SELECTORS.UPI);
            await page.fill(SELECTORS.UPI_ID, paymentDetails.upi_id ?? '');
            break;

        default:
            throw new Error(`Unsupported payment method: ${(paymentDetails as PaymentDetails).method}`);
    }

    await page.click(SELECTORS.PAY);
    console.log('[Payment] Payment submitted.');

    return response;
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

if (require.main === module) {
    const args = minimist<CliArgs>(process.argv.slice(2));

    const from           = args.from           || '';
    const to             = args.to             || '';
    const trainName      = args.train          || '';
    const className      = args.class          || '';
    const username       = args.username       || '';
    const password       = args.password       || '';
    const passengers: Passenger[]      = args.passengers ? JSON.parse(args.passengers) : [];
    const paymentDetails: PaymentDetails = args.payment   ? JSON.parse(args.payment)   : {};

    if (!from || !to || !trainName || !className || !username || !password) {
        console.error('Usage: ts-node automation.ts --from <FROM> --to <TO> --train <NAME> ' +
                      '--class <CLASS> --username <USER> --password <PASS> ' +
                      '--passengers \'[{"name":"...","age":"...","gender":"M"}]\' ' +
                      '--payment \'{"method":"UPI","upi_id":"..."}\' ');
        process.exit(1);
    }

    console.log(`[CLI] FROM=${from}  TO=${to}  TRAIN=${trainName}  CLASS=${className}`);

    bookTatkalTicket(trainName, className, from, to, { username, password }, passengers, paymentDetails)
        .then((res) => {
            console.log('[Done]', res);
            process.exit(0);
        })
        .catch((err: Error) => {
            console.error('[Error]', err.message);
            process.exit(1);
        });
}

export { bookTatkalTicket };
>>>>>>> refactor-done
