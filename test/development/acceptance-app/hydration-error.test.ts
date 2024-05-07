/* eslint-env jest */
import { sandbox } from 'development-sandbox'
import { FileRef, nextTestSetup } from 'e2e-utils'
import path from 'path'
import { outdent } from 'outdent'
import { getRedboxTotalErrorCount } from 'next-test-utils'

// https://github.com/facebook/react/blob/main/packages/react-dom/src/__tests__/ReactDOMHydrationDiff-test.js used as a reference

describe('Error overlay for hydration errors', () => {
  const { next, isTurbopack } = nextTestSetup({
    files: new FileRef(path.join(__dirname, 'fixtures', 'default-template')),
    dependencies: {
      react: '19.0.0-beta-4508873393-20240430',
      'react-dom': '19.0.0-beta-4508873393-20240430',
    },
    skipStart: true,
  })

  it('should show correct hydration error when client and server render different text', async () => {
    const { cleanup, session, browser } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'
            const isClient = typeof window !== 'undefined'
            export default function Mismatch() {
              return (
                <div className="parent">
                  <main className="child">{isClient ? "client" : "server"}</main>
                </div>
              );
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()

    expect(await session.getRedboxDescription()).toMatchInlineSnapshot(`
      "Error: Text content does not match server-rendered HTML.
      See more info here: https://nextjs.org/docs/messages/react-hydration-error"
    `)

    expect(await session.getRedboxDescriptionWarning()).toMatchInlineSnapshot(
      `"Text content did not match. Server: "server" Client: "client""`
    )

    const pseudoHtml = await session.getRedboxComponentStack()

    if (isTurbopack) {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "...
          <RedirectBoundary>
            <RedirectErrorBoundary>
              <InnerLayoutRouter>
                <Mismatch>
                  <div>
                    <main>
                      "server"
                      "client""
      `)
    } else {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "<Mismatch>
          <div>
            <main>
              "server"
              "client""
      `)
    }

    await session.patch(
      'app/page.js',
      outdent`
      'use client'
      export default function Mismatch() {
        return (
          <div className="parent">
            <main className="child">Value</main>
          </div>
        );
      }
    `
    )

    expect(await session.hasRedbox()).toBe(false)

    expect(await browser.elementByCss('.child').text()).toBe('Value')

    await cleanup()
  })

  it('should show correct hydration error when client renders an extra element', async () => {
    const { cleanup, session } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'
            const isClient = typeof window !== 'undefined'
            export default function Mismatch() {
              return (
                <div className="parent">
                  {isClient && <main className="only" />}
                </div>
              );
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()

    const pseudoHtml = await session.getRedboxComponentStack()
    if (isTurbopack) {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "...
          <Mismatch>
            <div>
            ^^^^^
              <main>
              ^^^^^^"
      `)
    } else {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "<Mismatch>
          <div>
          ^^^^^
            <main>
            ^^^^^^"
      `)
    }

    expect(await session.getRedboxDescription()).toMatchInlineSnapshot(`
        "Error: Hydration failed because the initial UI does not match what was rendered on the server.
        See more info here: https://nextjs.org/docs/messages/react-hydration-error"
    `)
    expect(await session.getRedboxDescriptionWarning()).toMatchInlineSnapshot(
      `"Expected server HTML to contain a matching <main> in <div>."`
    )

    await cleanup()
  })

  it('should show correct hydration error when client renders an extra text node', async () => {
    const { cleanup, session } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'
            const isClient = typeof window !== 'undefined'
            export default function Mismatch() {
              return (
                <div className="parent">
                  <header className="1" />
                  {isClient && "second"}
                  <footer className="3" />
                </div>
              );
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()

    expect(await session.getRedboxDescription()).toMatchInlineSnapshot(`
      "Error: Hydration failed because the initial UI does not match what was rendered on the server.
      See more info here: https://nextjs.org/docs/messages/react-hydration-error"
    `)

    expect(await session.getRedboxDescriptionWarning()).toMatchInlineSnapshot(
      `"Expected server HTML to contain a matching text node for "second" in <div>."`
    )

    await cleanup()
  })

  it('should show correct hydration error when server renders an extra element', async () => {
    const { cleanup, session } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'
            const isClient = typeof window !== 'undefined'
            export default function Mismatch() {
              return (
                <div className="parent">
                  {!isClient && <main className="only" />}
                </div>
              );
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()

    expect(await session.getRedboxDescription()).toMatchInlineSnapshot(`
        "Error: Hydration failed because the initial UI does not match what was rendered on the server.
        See more info here: https://nextjs.org/docs/messages/react-hydration-error"
      `)
    expect(await session.getRedboxDescriptionWarning()).toMatchInlineSnapshot(
      `"Did not expect server HTML to contain a <main> in <div>."`
    )

    await cleanup()
  })

  it('should show correct hydration error when server renders an extra text node', async () => {
    const { cleanup, session } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'
            const isClient = typeof window !== 'undefined'
            export default function Mismatch() {
              return <div className="parent">{!isClient && "only"}</div>;
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()

    expect(await session.getRedboxDescription()).toMatchInlineSnapshot(`
      "Error: Hydration failed because the initial UI does not match what was rendered on the server.
      See more info here: https://nextjs.org/docs/messages/react-hydration-error"
    `)

    expect(await session.getRedboxDescriptionWarning()).toMatchInlineSnapshot(
      `"Did not expect server HTML to contain the text node "only" in <div>."`
    )

    const pseudoHtml = await session.getRedboxComponentStack()

    if (isTurbopack) {
      expect(pseudoHtml).toMatchInlineSnapshot(`
              "...
                <NotFoundErrorBoundary>
                  <RedirectBoundary>
                    <RedirectErrorBoundary>
                      <InnerLayoutRouter>
                        <Mismatch>
                          <div>
                            <div>
                              "only""
            `)
    } else {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "<Mismatch>
          <div>
            <div>
              "only""
      `)
    }

    await cleanup()
  })

  it('should show correct hydration error when client renders an extra node inside Suspense content', async () => {
    const { cleanup, session } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'
            import React from "react"
            const isClient = typeof window !== 'undefined'
            export default function Mismatch() {
              return (
                <div className="parent">
                  <React.Suspense fallback={<p>Loading...</p>}>
                    <header className="1" />
                    {isClient && <main className="second" />}
                    <footer className="3" />
                  </React.Suspense>
                </div>
              );
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()

    expect(await session.getRedboxDescription()).toMatchInlineSnapshot(`
        "Error: Hydration failed because the initial UI does not match what was rendered on the server.
        See more info here: https://nextjs.org/docs/messages/react-hydration-error"
      `)

    expect(await session.getRedboxDescriptionWarning()).toMatchInlineSnapshot(
      `"Expected server HTML to contain a matching <main> in <div>."`
    )

    await cleanup()
  })

  it('should not show a hydration error when using `useId` in a client component', async () => {
    const { cleanup, browser } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'

            import { useId } from "react"

            export default function Page() {
              let id = useId();
              return (
                <div className="parent" data-id={id}>
                  Hello World
                </div>
              );
            }
          `,
        ],
      ])
    )

    const logs = await browser.log()
    const errors = logs
      .filter((x) => x.source === 'error')
      .map((x) => x.message)
      .join('\n')

    expect(errors).not.toInclude(
      'Warning: Prop `%s` did not match. Server: %s Client: %s'
    )

    await cleanup()
  })

  it('should only show one hydration error when bad nesting happened - p under p', async () => {
    const { cleanup, session, browser } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'

            export default function Page() {
              return (
                <p>
                  <p>Nested p tags</p>
                </p>
              )
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()
    expect(await session.hasRedbox()).toBe(true)

    expect(await getRedboxTotalErrorCount(browser)).toBe(1)

    const description = await session.getRedboxDescription()
    expect(description).toContain(
      'Error: Hydration failed because the initial UI does not match what was rendered on the server.'
    )
    const warning = await session.getRedboxDescriptionWarning()
    expect(warning).toContain(
      'In HTML, <p> cannot be a descendant of <p>.\nThis will cause a hydration error.'
    )

    const pseudoHtml = await session.getRedboxComponentStack()

    // Turbopack currently has longer component stack trace
    if (isTurbopack) {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "...
          <Page>
            <p>
            ^^^
              <p>
              ^^^"
      `)
    } else {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "<Page>
          <p>
          ^^^
            <p>
            ^^^"
      `)
    }

    await cleanup()
  })

  it('should only show one hydration error when bad nesting happened - div under p', async () => {
    const { cleanup, session, browser } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'

            export default function Page() {
              return (
                <div>
                  <div>
                    <p>
                      <div>Nested div under p tag</div>
                    </p>
                  </div>
                </div>
              )
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()
    expect(await session.hasRedbox()).toBe(true)

    expect(await getRedboxTotalErrorCount(browser)).toBe(1)

    const description = await session.getRedboxDescription()
    expect(description).toContain(
      'Error: Hydration failed because the initial UI does not match what was rendered on the server.'
    )
    const warning = await session.getRedboxDescriptionWarning()
    expect(warning).toContain(
      'In HTML, <div> cannot be a descendant of <p>.\nThis will cause a hydration error.'
    )

    const pseudoHtml = await session.getRedboxComponentStack()

    // Turbopack currently has longer component stack trace
    if (isTurbopack) {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "...
          <div>
            <p>
            ^^^
              <div>
              ^^^^^"
      `)
    } else {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "<Page>
          <div>
            <div>
              <p>
              ^^^
                <div>
                ^^^^^"
      `)
    }

    await cleanup()
  })

  it('should show the highlighted bad nesting html snippet when bad nesting happened', async () => {
    const { cleanup, session } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'

            export default function Page() {
              return (
                <p><span><span><span><span><p>hello world</p></span></span></span></span></p>
              )
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()
    expect(await session.hasRedbox()).toBe(true)

    const description = await session.getRedboxDescription()
    expect(description).toContain(
      'Error: Hydration failed because the initial UI does not match what was rendered on the server.'
    )
    const warning = await session.getRedboxDescriptionWarning()
    expect(warning).toContain(
      'In HTML, <p> cannot be a descendant of <p>.\nThis will cause a hydration error.'
    )

    const pseudoHtml = await session.getRedboxComponentStack()

    // Turbopack currently has longer component stack trace
    if (isTurbopack) {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "...
          <Page>
            <p>
            ^^^
              <span>
                ...
                  <span>
                    <p>
                    ^^^"
      `)
    } else {
      expect(pseudoHtml).toMatchInlineSnapshot(`
        "<Page>
          <p>
          ^^^
            <span>
              ...
                <span>
                  <p>
                  ^^^"
    `)
    }

    await cleanup()
  })

  it('should show error if script is directly placed under html instead of body', async () => {
    const { cleanup, session } = await sandbox(
      next,
      new Map([
        [
          'app/layout.js',
          outdent`
            import Script from 'next/script'

            export default function Layout({ children }) {
              return (
                <html>
                  <body>{children}</body>
                  <Script
                    src="https://example.com/script.js"
                    strategy="beforeInteractive"
                  />
                </html>
              )
            }
          `,
        ],
        [
          'app/page.js',
          outdent`
            export default function Page() {
              return <div>Hello World</div>
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()
    expect(await session.hasRedbox()).toBe(true)

    const warning = await session.getRedboxDescriptionWarning()
    expect(warning).toContain(
      'Cannot render a sync or defer <script> outside the main document without knowing its order. Try adding async="" or moving it into the root <head> tag.'
    )

    await cleanup()
  })

  it('should collapse and uncollapse properly when there are many frames', async () => {
    const { cleanup, session } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          outdent`
            'use client'

            const isServer = typeof window === 'undefined'
            
            function Mismatch() {
              return (
                <p>
                  <span>
                    
                    hello {isServer ? 'server' : 'client'}
                  </span>
                </p>
              )
            }
            
            export default function Page() {
              return (
                <div>
                  <div>
                    <div>
                      <div>
                        <Mismatch />
                      </div>
                    </div>
                  </div>
                </div>
              )
            }
          `,
        ],
      ])
    )

    await session.waitForAndOpenRuntimeError()
    expect(await session.hasRedbox()).toBe(true)

    const pseudoHtml = await session.getRedboxComponentStack()
    expect(pseudoHtml).toMatchInlineSnapshot(`
      "...
        <div>
          <div>
            <div>
              <Mismatch>
                <p>
                  <span>
                    "server"
                    "client""
    `)

    await session.toggleCollapseComponentStack()

    const fullPseudoHtml = await session.getRedboxComponentStack()
    if (isTurbopack) {
      expect(fullPseudoHtml).toMatchInlineSnapshot(`
              "<Root>
                <ServerRoot>
                  <AppRouter>
                    <ErrorBoundary>
                      <ErrorBoundaryHandler>
                        <Router>
                          <HotReload>
                            <ReactDevOverlay>
                              <DevRootNotFoundBoundary>
                                <NotFoundBoundary>
                                  <NotFoundErrorBoundary>
                                    <RedirectBoundary>
                                      <RedirectErrorBoundary>
                                        <RootLayout>
                                          <html>
                                            <body>
                                              <OuterLayoutRouter>
                                                <RenderFromTemplateContext>
                                                  <ScrollAndFocusHandler>
                                                    <InnerScrollAndFocusHandler>
                                                      <ErrorBoundary>
                                                        <LoadingBoundary>
                                                          <NotFoundBoundary>
                                                            <NotFoundErrorBoundary>
                                                              <RedirectBoundary>
                                                                <RedirectErrorBoundary>
                                                                  <InnerLayoutRouter>
                                                                    <Page>
                                                                      <div>
                                                                        <div>
                                                                          <div>
                                                                            <div>
                                                                              <Mismatch>
                                                                                <p>
                                                                                  <span>
                                                                                    "server"
                                                                                    "client""
            `)
    } else {
      expect(fullPseudoHtml).toMatchInlineSnapshot(`
        "<Page>
          <div>
            <div>
              <div>
                <div>
                  <Mismatch>
                    <p>
                      <span>
                        "server"
                        "client""
      `)
    }

    await cleanup()
  })
})
