import { expect, test } from '@playwright/test';

test('recruiter drafts, edits, approves and sends an interview invite', async ({
  page,
}, testInfo) => {
  await page.goto('/');

  await test.step('pick a candidate; their applied role is preselected', async () => {
    await page.getByTestId('candidate').selectOption({ label: 'Priya Sharma — Backend Engineer' });
    await expect(page.getByTestId('job')).toHaveValue('j-001');
  });

  await test.step('agent drafts and pauses for approval', async () => {
    await page.getByTestId('draft').click();
    const detail = page.getByTestId('run-detail');
    await expect(detail.getByTestId('run-state')).toHaveText('Awaiting approval');
    await expect(page.getByTestId('body')).toHaveValue(/^Hi Priya,/);
    await expect(detail.getByText('To: priya.sharma@example.com')).toBeVisible();
    await expect(detail.getByText(/\(s-101\)/)).toBeVisible();
  });

  await test.step('an unsafe edit is refused by guardrails', async () => {
    const body = page.getByTestId('body');
    const original = await body.inputValue();
    await body.fill(`${original}\n\nAlso, do you have family plans?`);
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('action-error')).toContainText('protected topic (family status)');
    await expect(page.getByTestId('run-detail').getByTestId('run-state')).toHaveText(
      'Awaiting approval',
    );
    await body.fill(`${original}\n\nP.S. The team is fully remote.`);
  });

  await test.step('recruiter approves the edited draft and it is sent', async () => {
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('sent-banner')).toContainText('Sent to priya.sharma@example.com');
    await expect(page.getByTestId('body')).toHaveValue(/The team is fully remote\.$/);
  });

  await test.step('execution history shows the full trace', async () => {
    await page.getByTestId('timeline').locator('summary').click();
    const timeline = page.getByTestId('timeline');
    for (const text of [
      'get_candidate ok',
      'get_interview_slots ok',
      'submit_draft ok',
      'recruiter approve (edited)',
      'send_message ok',
      'sending → sent',
    ]) {
      await expect(timeline).toContainText(text);
    }
  });

  await testInfo.attach('final-state', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
