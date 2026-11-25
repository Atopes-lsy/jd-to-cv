async (page) => {
  await page.reload();
  await page.locator('[data-page="profile"]').click();
  const previous = await page.locator('#profile-text').inputValue();
  let requests = 0;
  const onRequest = request => { if (request.url().endsWith('/api/model')) requests++; };
  page.on('request', onRequest);
  await page.locator('#profile-file').setInputFiles('examples/synthetic-jd.png');
  await page.waitForFunction(() => !document.querySelector('#profile-image-preview').hidden);
  if (requests !== 0) throw new Error('Selecting a private image triggered a network call');
  await page.locator('#profile-recognize').click();
  await page.waitForFunction(() => document.querySelector('#profile-text').value.includes('合成图片识别资料'));
  if (!(await page.locator('#profile-text').inputValue()).startsWith(previous)) throw new Error('Existing profile was overwritten');
  if (!(await page.locator('#profile-image-notes').textContent()).includes('核实')) throw new Error('Uncertainty notes lost');
  await page.screenshot({ path: 'output/playwright/mobile-profile-image.png', fullPage: true });
  await page.locator('#save-profile').click();
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('已保存'));
  await page.reload(); await page.locator('[data-page="profile"]').click();
  if (!(await page.locator('#profile-text').inputValue()).includes('合成图片识别资料')) throw new Error('Confirmed image-derived text not saved');
  if (!(await page.locator('#profile-image-preview').isHidden())) throw new Error('Private original image should not persist');
  page.off('request', onRequest);
  return { passed: true, workflows: ['profile image preview without request', 'explicit extraction', 'append without overwrite', 'uncertainty notes', 'confirmed text persists; original image not archived'] };
}
