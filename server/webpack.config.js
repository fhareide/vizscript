"use strict";

const path = require("path");

const configServer = {
  mode: "none",
  target: "node",
  node: {
    __dirname: false
  },
  resolve: {
    //mainFields: ["module", "main"],
    extensions: [".ts", ".js"]
  },
  module: {
    rules: [{
      test: /\.ts$/,
      exclude: /node_modules/,
      use: [{
        loader: "ts-loader",
        options: {
          compilerOptions: {
            "sourceMap": true
          }
        }
      }]
    }]
  },
  externals: {
    "vscode": "commonjs vscode",
  },
  entry: {
    extension: "./server/src/server.ts",
  },
  output: {
    filename: "server.js",
    path: path.join(__dirname, "out"),
    libraryTarget: "commonjs",
    devtoolModuleFilenameTemplate: "../[resource-path]"
  },
  devtool: "source-map"
};

module.exports = configServer;