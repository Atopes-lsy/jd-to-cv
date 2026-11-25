async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  await page.locator('[data-page="library"]').click(); await page.locator('#search').fill('');
  const before = await page.locator('.job-card').count();
  await page.locator('#restore').setInputFiles('output/playwright/history-101.json');
  await page.waitForFunction(count => document.querySelectorAll('.job-card').length === count + 1, before);
  const card = page.locator('.job-card').filter({ hasText: '101版本恢复测试' });
  check((await card.textContent()).includes('101 个版本'), 'Legacy history was truncated');
  await card.locator('button').first().click();
  await page.locator('#jd-text').fill('修改后的第 102 个版本');
  await page.locator('#archive').click();
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('100 个版本'));
  await page.locator('[data-page="library"]').click();
  const downloading = page.waitForEvent('download'); await page.locator('#backup').click();
  await (await downloading).saveAs('output/playwright/roundtrip-backup.json');
  const count = await page.locator('.job-card').count();
  await page.locator('#restore').setInputFiles('output/playwright/oversize-backup.json');
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('30 MB'));
  check(await page.locator('.job-card').count() === count, 'Oversize import changed records');
  // A resumed draft must disappear when a new screenshot is chosen.
  const withResume = page.locator('.job-card').filter({ hasText: '101版本恢复测试' });
  await withResume.locator('button').first().click();
  check(!(await page.locator('#print').isDisabled()), 'Fixture resume did not load');
  await page.locator('#image-file').setInputFiles('examples/synthetic-jd.png');
  await page.waitForFunction(() => document.querySelector('#print').disabled);
  check(await page.locator('#resume-paper').isHidden(), 'Old resume remains after screenshot replacement');
  // Cross-tab independent writes must not overwrite each other.
  const second = await page.context().newPage(); await second.goto('http://127.0.0.1:8765/');
  await second.waitForFunction(() => document.querySelector('#provider-status').textContent.includes('额度'));
  await page.locator('#new-job').click(); await second.locator('#new-job').click();
  await page.locator('#jd-text').fill('合成并发岗位 A'); await second.locator('#jd-text').fill('合成并发岗位 B');
  await Promise.all([page.locator('#archive').click(), second.locator('#archive').click()]);
  await Promise.all([page.waitForFunction(() => !document.querySelector('#archive').disabled), second.waitForFunction(() => !document.querySelector('#archive').disabled)]);
  await second.close();
  await page.locator('[data-page="library"]').click();
  await page.waitForFunction(expected => document.querySelectorAll('.job-card').length === expected, count + 2);
  // Import control is keyboard reachable and activates the file picker.
  await page.locator('label[for="restore"]').focus();
  const chooser = page.waitForEvent('filechooser'); await page.keyboard.press('Enter');
  await (await chooser).setFiles([]);
  await page.screenshot({ path: 'output/playwright/archive-regression.png', fullPage: true });
  return { passed: true, workflows: ['101 historical revisions preserved', 'new revision cap', 'oversize import without mutation', 'old resume invalidation', 'cross-tab writes', 'keyboard file picker'] };
}
