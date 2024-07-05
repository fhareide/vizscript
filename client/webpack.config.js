"use strict";

const path = require("path");
const webpack = require("webpack");

const configClient = {
  mode: "development",
  target: "node",
  node: {
    __dirname: false,
  },
  resolve: {
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
              transpileOnly: true,
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
    extension: ["webpack/hot/poll?1000", "./client/src/extension.ts"],
  },
  output: {
    filename: "extension.js",
    path: path.join(__dirname, "out"),
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  plugins: [new webpack.HotModuleReplacementPlugin()],
  devtool: "source-map",
};

module.exports = configClient;
