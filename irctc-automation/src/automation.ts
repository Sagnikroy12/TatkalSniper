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
            await page.click(SELECTORS.ADD_PASSENGER);
        }
    }

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
