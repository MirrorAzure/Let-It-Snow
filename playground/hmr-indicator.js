// Hot Module Replacement indicator - useful for debugging
if (import.meta.hot) {
  import.meta.hot.accept(modules => {
    console.log('🔄 Hot reload detected - content script updated');
  });
}

export {};
