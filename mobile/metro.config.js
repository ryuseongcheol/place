// 서버와 같은 분류·주제 코드(../lib)를 앱에서도 그대로 쓰기 위해 상위 lib 폴더를 함께 번들한다.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../lib")];
// ../lib 파일이 import 하는 패키지도 mobile/node_modules 에서 찾게 한다
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = config;
