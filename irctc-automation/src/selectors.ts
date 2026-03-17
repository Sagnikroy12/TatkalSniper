/**
 * Central repository of all CSS/XPath selectors for the IRCTC website.
 * Keeping selectors in one place makes it easy to update when the site changes.
 */
const SELECTORS = {
    // ─── Homepage ─────────────────────────────────────────────────────────────
    /** "OK" button on the IRCTC homepage cookie/terms banner */
    OK_BUTTON: '//button[normalize-space()="OK"]',
    /** Hamburger / three-dash menu icon */
    THREE_DASH: '//a[contains(@class,"hamburger")]',
    /** "LOGIN" link in the navigation */
    LOGIN: '//a[normalize-space()="LOGIN"]',

    // ─── Login Form ───────────────────────────────────────────────────────────
    USERNAME: '//input[@placeholder="User Name"]',
    PASSWORD: '//input[@placeholder="Password"]',
    /** Captcha image rendered inside the login form */
    CAPTCHA_IMAGE: '//app-captcha//img[@role="img"]',
    /** Captcha text input field */
    CAPTCHA_INPUT: '//input[@placeholder="Enter Captcha"]',
    /** The "SIGN IN" submit button */
    SIGN_IN: '//button[normalize-space()="SIGN IN"]',
    /** URL of the train-search page (used to detect successful login) */
    URL: 'https://www.irctc.co.in/nget/train-search',

    // ─── Train Search Form ────────────────────────────────────────────────────
    FROM: '//input[@placeholder="From"]',
    TO:   '//input[@placeholder="To"]',
    /** Journey class dropdown (3A, SL, etc.) */
    CLASS: '//p-dropdown[@id="journeyClass"]',
    /** Quota/type dropdown (TATKAL, PREMIUM TATKAL, etc.) */
    TYPE:  '//p-dropdown[@id="journeyQuota"]',
    /** Search trains button */
    SEARCH: '//button[normalize-space()="Search"]',

    // ─── Train Results ────────────────────────────────────────────────────────
    /** "NO" button in any confirmation / alternate-train dialog */
    NO: '//div[contains(@class,"modal-content")]//button[normalize-space()="NO"]',
    /** Top-level container for each alternate / fallback train card */
    FALLBACK_TRAIN: '//div[contains(@class,"train-heading")]/ancestor::div[contains(@class,"train-avl-enq")]',

    // ─── Passenger Form ───────────────────────────────────────────────────────
    NAME:          '//input[@placeholder="Passenger Name"]',
    AGE:           '//input[@placeholder="Age"]',
    GENDER:        '//select[contains(@id,"gender")]',
    ADD_PASSENGER: '//button[normalize-space()="Add Passenger"]',
    /** "Continue" button after passenger details */
    CONTINUE2: '//button[normalize-space()="Continue"]',

    // ─── Booking Captcha ──────────────────────────────────────────────────────
    /** Captcha image on the booking/payment page */
    BOOKING_CAPTCHA_IMAGE: '//app-captcha//img[@role="img"]',
    /** Captcha input on the booking/payment page */
    BOOKING_CAPTCHA_INPUT: '//input[@placeholder="Enter Captcha"]',
    /** "Continue" button that submits the booking captcha */
    CONTINUE3: '//button[normalize-space()="Continue"]',

    // ─── Payment Page ─────────────────────────────────────────────────────────
    PAY_BOOK:        '//button[contains(normalize-space(),"Pay and Book")]',
    CREDIT_CARD:     '//li[contains(normalize-space(),"Credit Card")]',
    DEBIT_CARD:      '//li[contains(normalize-space(),"Debit Card")]',
    UPI:             '//li[contains(normalize-space(),"UPI")]',
    CARD_NUMBER:     '//input[@placeholder="Card Number"]',
    VALID_THRU:      '//input[@placeholder="MM/YY"]',
    CVV:             '//input[@placeholder="CVV"]',
    CARD_HOLDER_NAME:'//input[@placeholder="Name on Card"]',
    UPI_ID:          '//input[@placeholder="Enter UPI ID"]',
    PAY:             '//button[contains(normalize-space(),"Make Payment")]',
} as const;

export default SELECTORS;
