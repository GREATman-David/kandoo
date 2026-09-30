// Expo's default Metro config, minus native build output.
//
// A 4-ABI release build leaves gigabytes of Gradle/CMake output in android/
// (and in each native library's android/.cxx). There is no JavaScript in any
// of it, but Metro's file watcher crawls it all on start-up and gives up with
// "Failed to start watch mode". Blocking it keeps Metro starting in seconds.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sep = '[\\\\/]';

config.resolver.blockList = [
  // The generated native project at the root.
  new RegExp(`^${escape(path.join(__dirname, 'android'))}${sep}.*`),
  // Native build output inside libraries.
  new RegExp(`${sep}android${sep}(build|\\.cxx|\\.gradle)${sep}.*`),
  // The backend runs on its own; the app never bundles it.
  new RegExp(`^${escape(path.join(__dirname, 'backend'))}${sep}node_modules${sep}.*`),
];

module.exports = config;
