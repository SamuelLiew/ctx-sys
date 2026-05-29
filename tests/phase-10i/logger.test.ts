import { consoleLogger, nullLogger, createLogger, Logger } from '../../src/utils/logger';

/**
 * v2 F1.4: consoleLogger + createLogger now route every level to
 * process.stderr (never stdout) so the MCP stdio transport is never
 * polluted by library logs. Tests updated to spy on stderr.write.
 */
function spyStderr(): jest.SpyInstance {
  return jest.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
}

function asWrites(spy: jest.SpyInstance): string[] {
  return spy.mock.calls.map(c => (c[0] as string).trim());
}

describe('Logger', () => {
  describe('consoleLogger', () => {
    it('should have all log methods', () => {
      expect(typeof consoleLogger.debug).toBe('function');
      expect(typeof consoleLogger.info).toBe('function');
      expect(typeof consoleLogger.warn).toBe('function');
      expect(typeof consoleLogger.error).toBe('function');
    });

    it('should write warn level to stderr', () => {
      const spy = spyStderr();
      consoleLogger.warn('test warning');
      expect(asWrites(spy)).toContain('test warning');
      spy.mockRestore();
    });

    it('should write error level to stderr', () => {
      const spy = spyStderr();
      consoleLogger.error('test error');
      expect(asWrites(spy)).toContain('test error');
      spy.mockRestore();
    });

    it('should be silent at debug level by default', () => {
      const spy = spyStderr();
      consoleLogger.debug('should be silent');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('nullLogger', () => {
    it('should produce no output', () => {
      const spy = spyStderr();
      nullLogger.debug('test');
      nullLogger.info('test');
      nullLogger.warn('test');
      nullLogger.error('test');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('createLogger', () => {
    it('should suppress warn when minLevel is error', () => {
      const logger = createLogger('error');
      const spy = spyStderr();

      logger.warn('should be suppressed');
      logger.error('should appear');

      expect(asWrites(spy)).toContain('should appear');
      expect(asWrites(spy)).not.toContain('should be suppressed');
      spy.mockRestore();
    });

    it('should output all levels when minLevel is debug', () => {
      const logger = createLogger('debug');
      const spy = spyStderr();

      logger.debug('d');
      logger.info('i');
      logger.warn('w');

      const writes = asWrites(spy);
      expect(writes).toContain('d');
      expect(writes).toContain('i');
      expect(writes).toContain('w');
      spy.mockRestore();
    });

    it('should suppress everything when minLevel is silent', () => {
      const logger = createLogger('silent');
      const spy = spyStderr();

      logger.error('should be suppressed');

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should default to warn level', () => {
      const logger = createLogger();
      const spy = spyStderr();

      logger.info('suppressed');
      logger.warn('shown');

      const writes = asWrites(spy);
      expect(writes).not.toContain('suppressed');
      expect(writes).toContain('shown');
      spy.mockRestore();
    });
  });

  describe('Logger interface', () => {
    it('should be implementable as a custom logger', () => {
      const messages: string[] = [];
      const custom: Logger = {
        debug: (msg) => { messages.push(`D:${msg}`); },
        info: (msg) => { messages.push(`I:${msg}`); },
        warn: (msg) => { messages.push(`W:${msg}`); },
        error: (msg) => { messages.push(`E:${msg}`); },
      };

      custom.debug('a');
      custom.info('b');
      custom.warn('c');
      custom.error('d');

      expect(messages).toEqual(['D:a', 'I:b', 'W:c', 'E:d']);
    });
  });
});
