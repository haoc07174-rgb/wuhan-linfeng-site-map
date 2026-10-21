# 武汉林凤装饰集团工地图

一个可静态托管的武汉工地小区地图。界面适配桌面浏览器和 iPhone Safari；地图基于高德地图 JS API 2.0。

## 本地打开

双击 `run-local.cmd`，浏览器会打开 `http://localhost:4173`。首次使用时，在“地图连接设置”中输入高德 Web 端 Key 和 JS API 安全密钥。

设置只存入当前浏览器的本地存储，不在 HTML、JavaScript 或数据文件中保存。部署到网站前，建议在高德开放平台为 Web Key 设置允许访问的域名，并通过 HTTPS 提供页面；不要把 Key 或安全密钥提交到公开 GitHub 仓库。

## 页面功能

- 武汉地图、行政区边界、拖动和缩放。
- 按小区表中的区域筛选；支持小区名称搜索和定位。
- 小区地址通过高德 Geocoder 查询，坐标缓存在当前浏览器，减少重复请求。
- 金黄色 Callout 气泡按邻近密度调整字号，并通过八方向、多级外扩和视口边界检测减少重叠。
- 手机上的地图和筛选面板采用上下分区布局，支持 Safari 安全区。

## 数据来源与范围

`data/neighborhoods.json` 由桌面上可读取的武汉工程地址工作簿生成。保留 15 个武汉业务区域的 406 个小区名称，并从区域汇总页保留 671 条武汉开工记录数；鄂州、咸宁、三亚的 5 个小区和 5 条记录排除。来源只提供逐小区名称及按区域汇总的开工记录数，没有逐小区开工记录明细或当前状态，因此地图以小区为点位，区域记录数只用于汇总展示。

武汉全市 13 个行政区边界由高德行政区查询绘制。东湖高新区、经开区属于工作簿内的业务区域，作为筛选项保留。

## 文件

- `index.html`、`styles.css`、`app.js`：网站界面。
- `data/neighborhoods.json`：武汉区域小区清单。
- `data/summary.json`：区域统计。
- `run-local.cmd`、`serve.mjs`：本地预览启动器。

## 高德文档

- [地图 JS API 2.0：地理编码与逆地理编码](https://lbs.amap.com/api/javascript-api-v2/guide/services/geocoder)
- [地图 JS API 2.0：行政区划查询示例](https://lbs.amap.com/demo/javascript-api-v2/example/district-search/city-drop-down-list)

