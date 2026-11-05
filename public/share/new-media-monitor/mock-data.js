// 大会集锦 H5 Demo 数据。正式版可由监控服务输出同结构 JSON，替换此文件即可。
window.CONFERENCE_DATA = {
  meta: {
    title: "中国新媒体大会",
    subtitle: "会议高光集锦",
    englishTitle: "CHINA NEW MEDIA CONFERENCE",
    updateText: "刚刚更新",
    isLive: true
  },
  timeline: [
    {
      id: "t-1530",
      time: "15:30",
      title: "大会精彩瞬间",
      summary: "主论坛现场观点交锋，一起回顾此刻的精彩画面。",
      media: [
        { type: "photo", id: "p-stage" },
        { type: "photo", id: "p-forum" }
      ]
    },
    {
      id: "t-1420",
      time: "14:20",
      title: "主论坛高光回顾",
      summary: "聚焦媒体深度融合与智能传播，嘉宾分享行业前沿观察。",
      media: [{ type: "video", id: "v-forum" }]
    },
    {
      id: "t-1340",
      time: "13:40",
      title: "圆桌对话：共话媒体新生态",
      summary: "围绕内容创新、技术赋能与产业协同，现场嘉宾展开深入交流。",
      media: [{ type: "photo", id: "p-roundtable" }]
    },
    {
      id: "t-1000",
      time: "10:00",
      title: "大会正式开幕",
      summary: "中国新媒体大会今日正式开幕，大会聚焦媒体融合与智能传播。",
      media: [{ type: "photo", id: "p-opening" }]
    },
    {
      id: "t-0930",
      time: "09:30",
      title: "嘉宾陆续入场",
      summary: "参会嘉宾陆续抵达会场，大会各项议程即将开启。",
      media: [{ type: "photo", id: "p-audience" }]
    }
  ],
  photos: [
    {
      id: "p-stage",
      src: "assets/stage.jpg",
      title: "主论坛精彩瞬间",
      category: "主论坛",
      time: "15:30",
      alt: "大会主论坛舞台与现场观众示意图"
    },
    {
      id: "p-forum",
      src: "assets/forum.jpg",
      title: "嘉宾聚焦行业前沿",
      category: "主论坛",
      time: "15:28",
      alt: "大会嘉宾认真聆听论坛分享示意图"
    },
    {
      id: "p-roundtable",
      src: "assets/roundtable.jpg",
      title: "圆桌对话思想碰撞",
      category: "圆桌对话",
      time: "13:40",
      alt: "大会现场嘉宾面向观众交流分享示意图"
    },
    {
      id: "p-speaker",
      src: "assets/speaker.jpg",
      title: "主题演讲观点分享",
      category: "主题演讲",
      time: "11:20",
      alt: "主题演讲现场的话筒与观众示意图"
    },
    {
      id: "p-opening",
      src: "assets/detail.jpg",
      title: "大会正式拉开帷幕",
      category: "开幕式",
      time: "10:00",
      alt: "大会开幕现场灯光与观众示意图"
    },
    {
      id: "p-audience",
      src: "assets/audience.jpg",
      title: "参会嘉宾陆续入场",
      category: "大会现场",
      time: "09:30",
      alt: "大会现场观众陆续入场示意图"
    }
  ],
  videos: [
    {
      id: "v-forum",
      poster: "assets/speaker.jpg",
      src: "assets/highlight-demo.mp4",
      title: "主论坛高光回顾",
      time: "14:20",
      duration: "02:36",
      summary: "聚焦媒体深度融合与智能传播，回顾主论坛精彩发言。"
    },
    {
      id: "v-roundtable",
      poster: "assets/roundtable.jpg",
      src: "assets/highlight-demo.mp4",
      title: "圆桌对话：媒体融合新生态",
      time: "13:40",
      duration: "01:48",
      summary: "多元视角碰撞，探讨内容创新与产业协同的新路径。"
    },
    {
      id: "v-speech",
      poster: "assets/stage.jpg",
      src: "assets/highlight-demo.mp4",
      title: "主题演讲：智能传播新趋势",
      time: "11:20",
      duration: "03:12",
      summary: "从技术演进出发，解读智能技术如何重塑内容生产。"
    },
    {
      id: "v-opening",
      poster: "assets/detail.jpg",
      src: "assets/highlight-demo.mp4",
      title: "大会开幕精彩直击",
      time: "10:00",
      duration: "00:58",
      summary: "一分钟回到开幕现场，感受大会热烈氛围。"
    }
  ]
};
