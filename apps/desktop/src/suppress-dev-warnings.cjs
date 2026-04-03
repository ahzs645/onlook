const baselineWarningPrefix = '[baseline-browser-mapping]';

if (process.env.ONLOOK_DESKTOP_MODE === 'true') {
    const originalWarn = console.warn.bind(console);

    console.warn = (...args) => {
        const [firstArg] = args;

        if (typeof firstArg === 'string' && firstArg.startsWith(baselineWarningPrefix)) {
            return;
        }

        originalWarn(...args);
    };
}
