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
            await page.click(SELECTORS.ADD_PASSENGER);
        }
    }

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
