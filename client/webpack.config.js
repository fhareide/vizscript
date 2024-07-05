"use strict";

const path = require("path");

const configClient = {
  mode: "none",
  target: "node",
  node: {
    __dirname: false,
  },
  resolve: {
    //mainFields: ["module", "main"],
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
            options: {
              compilerOptions: {
                sourceMap: true,
              },
            },
          },
        ],
      },
    ],
  },
  externals: {
    vscode: "commonjs vscode",
  },
  entry: {
    extension: "./client/src/extension.ts",
  },
  output: {
    filename: "extension.js",
    path: path.join(__dirname, "out"),
    libraryTarget: "commonjs",
  },
  devtool: "source-map",
};

module.exports = configClient;
