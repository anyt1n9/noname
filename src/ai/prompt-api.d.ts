// Chrome に入っている AI（Prompt API）の型。TypeScript の標準にはまだないので、使う分だけ書く
interface LanguageModelSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface LanguageModelExpected {
  type: 'text';
  languages: string[];
}

interface LanguageModelMonitor {
  addEventListener(type: 'downloadprogress', listener: (e: { loaded: number }) => void): void;
}

interface LanguageModelCreateOptions {
  initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[];
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
  monitor?: (m: LanguageModelMonitor) => void;
  signal?: AbortSignal;
}

interface LanguageModelStatic {
  availability(options?: Pick<LanguageModelCreateOptions, 'expectedInputs' | 'expectedOutputs'>): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare var LanguageModel: LanguageModelStatic | undefined;
