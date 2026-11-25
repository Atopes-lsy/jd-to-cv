async (page) => {
  await page.locator('[data-page="library"]').click();
  const before = await page.locator('.job-card').count();
  await page.locator('#restore').setInputFiles('output/playwright/resumes-101.json');
  await page.waitForFunction(count => document.querySelectorAll('.job-card').length === count + 1, before);
  await page.locator('.job-card').filter({ hasText: '101简历恢复测试' }).locator('button').first().click();
  await page.locator('#resume-paper h1').fill('历史简历（已核对）');
  await page.locator('#settings-open').click(); await page.locator('#settings-close').click();
  await page.locator('[data-page="library"]').click();
  const downloading = page.waitForEvent('download'); await page.locator('#backup').click();
  await (await downloading).saveAs('output/playwright/resume-history-roundtrip.json');
  return { passed: true, action: 'Restored 101 resume drafts, edited and blurred, exported for independent count/evidence verification.' };
}
