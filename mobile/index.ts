import { registerRootComponent } from "expo";

// 백그라운드 수집 작업 정의는 앱 컴포넌트보다 먼저 전역에서 해야 한다 (앱이 꺼진 상태에서도 실행되도록)
import "./src/backgroundCrawl";
import App from "./App";

registerRootComponent(App);
