import { Page } from 'playwright';

<<<<<<< HEAD
const DATE = '//*[@id="jDate"]/span/input';

export async function selectTomorrow(page: Page) {
    await page.click(DATE); // Open the calendar

    // Wait for the calendar to appear and get the highlighted date element
    const highlightedDateElement = await page.waitForSelector('//a[contains(@class,"ui-state-highlight")]');
    const highlightedDay = parseInt(await highlightedDateElement.textContent() || '1', 10);
    console.log(`Highlighted day: ${highlightedDay}`);

    // Get the current month and year from the calendar header
    const monthText = await page.textContent('//span[contains(@class, "ui-datepicker-month")]');
    const yearText = await page.textContent('//span[contains(@class, "ui-datepicker-year")]');
    const month = monthText?.trim() || '';
    const year = parseInt(yearText?.trim() || '', 10);

    // Calculate tomorrow's date
    const today = new Date(`${month} ${highlightedDay}, ${year}`);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    
    // Navigate to the correct month/year if needed
    while (
        tomorrow.getMonth() !== today.getMonth() ||
        tomorrow.getFullYear() !== today.getFullYear()
    ) {
        // Click the "next month" button (update selector if needed)
        await page.click('//a[contains(@class, "ui-datepicker-next")]');
        // Update today to the new calendar view
        const newMonthText = await page.textContent('//span[contains(@class, "ui-datepicker-month")]');
        const newYearText = await page.textContent('//span[contains(@class, "ui-datepicker-year")]');
        today.setMonth(new Date(`${newMonthText} 1, ${newYearText}`).getMonth());
        today.setFullYear(parseInt(newYearText || '', 10));
    }

    // Format for aria-label (e.g., "Aug 26, 2025")
    const monthShort = tomorrow.toLocaleString('default', { month: 'short' });
    const ariaLabel = `${monthShort} ${tomorrow.getDate()}, ${tomorrow.getFullYear()}`;
    const dateCell = await page.$(`//td[@aria-label="${ariaLabel}"]`);
    if(dateCell){
        await dateCell.click();
    }else{
        await page.click(`//a[text()="${tomorrow.getDate()}"]`);
    }
=======
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
>>>>>>> refactor-done
}
