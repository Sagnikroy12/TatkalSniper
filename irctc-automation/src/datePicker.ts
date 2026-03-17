import { Page } from 'playwright';

/**
 * Selects tomorrow's date in the IRCTC PrimeNG calendar date-picker.
 * The widget renders a month grid; we navigate to the correct month if needed
 * and click on the cell whose date text matches tomorrow's date number.
 */
export async function selectTomorrow(page: Page): Promise<void> {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const tomorrowDay = tomorrow.getDate();
    const tomorrowMonth = tomorrow.getMonth(); // 0-indexed
    const tomorrowYear = tomorrow.getFullYear();

    // Open the calendar by clicking the date input
    await page.click('//p-calendar[@id="journeyDate"]//input');

    // Wait for the calendar panel to appear
    await page.waitForSelector('//div[contains(@class,"ui-datepicker")]', { timeout: 3000 });

    // Read the currently displayed month/year from the calendar header
    const readDisplayed = async (): Promise<{ month: number; year: number }> => {
        const monthName = await page.textContent('//span[contains(@class,"ui-datepicker-month")]') ?? '';
        const yearText  = await page.textContent('//span[contains(@class,"ui-datepicker-year")]') ?? '';
        const monthIndex = new Date(`${monthName.trim()} 1, 2000`).getMonth();
        return { month: monthIndex, year: parseInt(yearText.trim(), 10) };
    };

    // Navigate forward until the correct month/year is displayed
    let displayed = await readDisplayed();
    while (
        displayed.year < tomorrowYear ||
        (displayed.year === tomorrowYear && displayed.month < tomorrowMonth)
    ) {
        await page.click('//a[contains(@class,"ui-datepicker-next")]');
        await page.waitForTimeout(300);
        displayed = await readDisplayed();
    }

    // Click the day cell matching tomorrow's date (only enabled/active cells)
    const daySelector =
        `//td[not(contains(@class,"ui-state-disabled"))]` +
        `/a[contains(@class,"ui-state-default") and normalize-space(text())="${tomorrowDay}"]`;

    await page.waitForSelector(daySelector, { timeout: 3000 });
    await page.click(daySelector);
}
