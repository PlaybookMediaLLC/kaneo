import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  staticDirs: ["../stories/public"],
  core: { disableTelemetry: true },
  viteFinal(config) {
    return {
      ...config,
      plugins: [
        ...(config.plugins ?? []),
        {
          name: "widget-fixture-directory",
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              const fixture = "/fixtures/api/quills-public/demo/widget";
              if (req.url?.split("?")[0] !== fixture) return next();
              // Storybook's dev server does not resolve directory indexes.
              res.writeHead(302, { Location: `${fixture}/index.html` });
              res.end();
            });
          },
        },
      ],
    };
  },
};

export default config;
