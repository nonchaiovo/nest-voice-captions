# NEST 滚动字幕

NEST Voice Captions

语音逐字字幕的核心算法参考：根据音频时间戳推进文字，并让文字定位到对应的播放位置。

这个目录包含从 NEST 提取的五个无框架依赖的纯函数，以及面向 AI 编程助手的接入文档。它不包含完整播放器、语音合成服务、聊天业务或 NEST 界面皮肤。

## 获取文档

- **只拿一个文件**：[下载技术实现 PDF](NEST滚动字幕-技术实现.pdf?raw=true)。接入说明、核心代码和测试都在里面，可以直接交给 AI。
- **在线阅读**：[AI 技术实现文档](IMPLEMENTATION.md)。

## 能做什么

- 文字随音频进度逐字变深，保持自然换行与真实停顿。
- 为点字跳播提供可靠时间戳；没有对齐的文字不会生成虚假的定位时间。
- 按 Unicode grapheme 分字，兼容中文、混合语言、组合字符与 emoji。
- 对特定分段拼接 MP3 的重复索引提供兼容处理。

文档还说明了暂停续播、流式字幕晚到、打断与恢复，以及 TTS 情绪／语气标签的处理原则。播放器和标签清理需要接入方实现；本仓库提供的现成代码是下方五个核心算法函数。

## 运行测试

使用 Node.js 18 或更高版本，无需安装依赖：

```sh
npm test
```

## 基础用法

```js
import {
  alignRecognizedWords,
  voiceRevealTimes,
} from './caption-core.mjs';

const alignment = alignRecognizedWords('你好，回来。', [
  { word: '你好', start: 2, end: 2.8, confidence: 0.99 },
  { word: '回来', start: 5, end: 5.8, confidence: 0.99 },
]);

const revealTimes = voiceRevealTimes(
  alignment,
  'deepgram-word-timestamps',
);

// 展示时间：[2, 2.4, null, 5, 5.4, null]
// 点击“好”时用 alignment[1].start，即真实词起点 2 秒。
// 不能把视觉插值后的 2.4 秒当成声学测量值。
```

## 函数

| 函数 | 用途 |
| --- | --- |
| `voiceTextUnits(text)` | 按 grapheme 分割前端显示文字 |
| `normalizeAlignment(text, result)` | 校验并规范化字符级强制对齐结果 |
| `alignRecognizedWords(text, words, options)` | 保守地把识别词时间戳映射到原文 |
| `voiceRevealTimes(timing, source)` | 在同一测量词内部细分显示时间，不修改跳播时间 |
| `normalizeVoiceMp3Seek(bytes)` | 对特定多段拼接 MP3 的重复索引做本地兼容处理 |

`alignRecognizedWords` 可以返回 `null`。未匹配文字的时间也是 `null`；界面必须禁用这些文字的精确定位，不能把空值转换成零。

## 接入原则

- 声音先播放，对齐异步完成。不要重新合成另一段录音来对齐当前声音。
- 根据播放器真实时钟推进显示；视觉估算不能生成精确跳播时间。
- 流式片段与保存回放分别管理时间轴，迟到响应要校验所属播放轮次。
- 接入方提供自己的控件、布局和视觉样式。

完整流程、数据契约、服务端适配、流式生命周期和验收清单见 [AI 技术实现文档](IMPLEMENTATION.md)。

测试涵盖 Unicode、真实停顿、词内显示细分、部分对齐、低置信度过滤和 MP3 索引兼容。真实音频、供应商接口及目标设备仍需由接入方验证。

## 使用许可

沿用本账号其他公开项目的许可：允许个人非商业使用与修改，须保留署名；不允许商业使用或公开再分发。完整条款见 [LICENSE](LICENSE)。

NEST 的气泡样式、主题参数、界面模板和应用业务代码不包含在本仓库中。
