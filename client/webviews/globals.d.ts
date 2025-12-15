declare global {
  const tsvscode: {
    postMessage: ({ type, value }: { type: string; value?: any }) => void;
    getState: () => any;
    setState: (newState: any) => void;
  };
}

export {};
