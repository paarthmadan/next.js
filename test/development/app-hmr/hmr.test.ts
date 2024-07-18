import { nextTestSetup } from 'e2e-utils'
import { retry, waitFor } from 'next-test-utils'

const envFile = '.env.development.local'

const isPPREnabledByDefault = process.env.__NEXT_EXPERIMENTAL_PPR === 'true'

describe(`app-dir-hmr`, () => {
  const { next } = nextTestSetup({
    files: __dirname,
  })

  describe('filesystem changes', () => {
    it('should not continously poll when hitting a not found page', async () => {
      let requestCount = 0

      const browser = await next.browser('/does-not-exist', {
        beforePageLoad(page) {
          page.on('request', (request) => {
            const url = new URL(request.url())
            if (url.pathname === '/does-not-exist') {
              requestCount++
            }
          })
        },
      })
      const body = await browser.elementByCss('body').text()
      expect(body).toContain('404')

      await waitFor(3000)

      expect(requestCount).toBe(1)
    })

    it('should not break when renaming a folder', async () => {
      const browser = await next.browser('/folder')
      const text = await browser.elementByCss('h1').text()
      expect(text).toBe('Hello')

      // Rename folder
      await next.renameFolder('app/folder', 'app/folder-renamed')

      try {
        // Should be 404 in a few seconds
        await retry(async () => {
          const body = await browser.elementByCss('body').text()
          expect(body).toContain('404')
        })

        // The new page should be rendered
        const newHTML = await next.render('/folder-renamed')
        expect(newHTML).toContain('Hello')
      } finally {
        // Rename it back
        await next.renameFolder('app/folder-renamed', 'app/folder')
      }
    })

    it('should update server components after navigating to a page with a different runtime', async () => {
      const envContent = await next.readFile(envFile)

      const browser = await next.browser('/env/node')
      await browser.loadPage(`${next.url}/env/edge`)
      await browser.eval('window.__TEST_NO_RELOAD = true')

      await next.patchFile(envFile, 'MY_DEVICE="ipad"')

      try {
        const logs = await browser.log()

        if (process.env.TURBOPACK) {
          await retry(async () => {
            const fastRefreshLogs = logs.filter((log) => {
              return log.message.startsWith('[Fast Refresh]')
            })
            // FIXME:  3+ "rebuilding" but single "done" is confusing.
            // There may actually be more "rebuilding" but not reliably.
            // To ignore this flakiness, we just assert on subset matches.
            // Once the  bug is fixed, each "rebuilding" should be paired with a "done in" exactly.
            expect(fastRefreshLogs).toEqual(
              expect.arrayContaining([
                { source: 'log', message: '[Fast Refresh] rebuilding' },
                { source: 'log', message: '[Fast Refresh] rebuilding' },
                {
                  source: 'log',
                  message: expect.stringContaining('[Fast Refresh] done in '),
                },
                { source: 'log', message: '[Fast Refresh] rebuilding' },
              ])
            )
          })
        } else {
          await retry(
            async () => {
              const fastRefreshLogs = logs.filter((log) => {
                return log.message.startsWith('[Fast Refresh]')
              })
              // FIXME: Should be either a single "rebuilding"+"done" or the last "rebuilding" should be followed by "done"
              expect(fastRefreshLogs).toEqual([
                { source: 'log', message: '[Fast Refresh] rebuilding' },
                { source: 'log', message: '[Fast Refresh] rebuilding' },
                {
                  source: 'log',
                  message: expect.stringContaining('[Fast Refresh] done in '),
                },
                { source: 'log', message: '[Fast Refresh] rebuilding' },
              ])
            },
            // Very slow Hot Update for some reason.
            // May be related to receiving 3 rebuild events but only one finish event
            5000
          )
        }
        const envValue = await browser.elementByCss('p').text()
        const mpa = await browser.eval('window.__TEST_NO_RELOAD === undefined')
        // Flaky sometimes in Webpack:
        // A. misses update and just receives `{ envValue: 'mac', mpa: false }`
        // B. triggers error on server resulting in MPA: `{ envValue: 'ipad', mpa: true }` and server logs: ⨯ [TypeError: Cannot read properties of undefined (reading 'polyfillFiles')] ⨯ [TypeError: Cannot read properties of null (reading 'default')]
        // A is more common than B.
        expect({ envValue, mpa }).toEqual({
          envValue:
            isPPREnabledByDefault && !process.env.TURBOPACK
              ? // FIXME: Should be 'ipad' but PPR+Webpack swallows the update reliably
                'mac'
              : 'ipad',
          mpa: false,
        })
      } finally {
        await next.patchFile(envFile, envContent)
      }
    })

    it('should update server components pages when env files is changed (nodejs)', async () => {
      // If "should update server components after navigating to a page with a different runtime" failed, the dev server is in a corrupted state.
      // Restart fixes this.
      await next.stop()
      await next.start()

      const envContent = await next.readFile(envFile)
      const browser = await next.browser('/env/node')
      expect(await browser.elementByCss('p').text()).toBe('mac')
      await next.patchFile(envFile, 'MY_DEVICE="ipad"')

      const logs = await browser.log()
      await retry(async () => {
        expect(logs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: '[Fast Refresh] rebuilding',
              source: 'log',
            }),
          ])
        )
      })

      try {
        await retry(async () => {
          expect(await browser.elementByCss('p').text()).toBe('ipad')
        })

        expect(logs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining('[Fast Refresh] done in'),
              source: 'log',
            }),
          ])
        )
      } finally {
        await next.patchFile(envFile, envContent)
      }
    })

    it('should update server components pages when env files is changed (edge)', async () => {
      // Restart to work around a bug highlighted in the flakiness of "should update server components after navigating to a page with a different runtime"
      await next.stop()
      await next.start()

      const envContent = await next.readFile(envFile)
      const browser = await next.browser('/env/edge')
      expect(await browser.elementByCss('p').text()).toBe('mac')
      await next.patchFile(envFile, 'MY_DEVICE="ipad"')

      const logs = await browser.log()
      await retry(async () => {
        expect(logs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: '[Fast Refresh] rebuilding',
              source: 'log',
            }),
          ])
        )
      })

      try {
        await retry(async () => {
          expect(await browser.elementByCss('p').text()).toBe('ipad')
        })

        expect(logs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining('[Fast Refresh] done in'),
              source: 'log',
            }),
          ])
        )
      } finally {
        await next.patchFile(envFile, envContent)
      }
    })

    it('should have no unexpected action error for hmr', async () => {
      expect(next.cliOutput).not.toContain('Unexpected action')
    })

    it('can navigate cleanly to a page that requires a change in the Webpack runtime', async () => {
      // This isn't a very accurate test since the Webpack runtime is somewhat an implementation detail.
      // To ensure this is still valid, check the `*/webpack.*.hot-update.js` network response content when the navigation is triggered.
      // If there is new functionality added, the test is still valid.
      // If not, the test doesn't cover anything new.
      // TODO: Enforce console.error assertions or MPA navigation assertions in all tests instead.
      const browser = await next.browser('/bundler-runtime-changes')
      await browser.eval('window.__TEST_NO_RELOAD = true')

      await browser
        .elementByCss('a')
        .click()
        .waitForElementByCss('[data-testid="new-runtime-functionality-page"]')

      const logs = await browser.log()
      if (process.env.TURBOPACK) {
        // FIXME: logging "rebuilding" multiple times instead of closing it of with "done in"
        // Should just not branch here and have the same logs as Webpack.
        expect(logs).toEqual(
          expect.arrayContaining([
            {
              message: '[Fast Refresh] rebuilding',
              source: 'log',
            },
            {
              message: '[Fast Refresh] rebuilding',
              source: 'log',
            },
            {
              message: '[Fast Refresh] rebuilding',
              source: 'log',
            },
          ])
        )
        expect(logs).not.toEqual(
          expect.arrayContaining([
            {
              message: expect.stringContaining('[Fast Refresh] done in'),
              source: 'log',
            },
          ])
        )
      } else {
        // TODO: Should assert on all logs but these are cluttered with logs from our test utils (e.g. playwright tracing or webdriver)
        expect(logs).toEqual(
          expect.arrayContaining([
            {
              message: '[Fast Refresh] rebuilding',
              source: 'log',
            },
            {
              message: expect.stringContaining('[Fast Refresh] done in'),
              source: 'log',
            },
          ])
        )
        expect(logs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: 'error',
            }),
          ])
        )
      }
      if (process.env.TURBOPACK) {
        // No MPA navigation triggered
        expect(await browser.eval('window.__TEST_NO_RELOAD')).toEqual(true)
      } else {
        // MPA navigation triggered
        expect(await browser.eval('window.__TEST_NO_RELOAD')).toEqual(undefined)
      }
    })
  })
})
