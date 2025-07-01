import { Page } from 'playwright';

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
}
