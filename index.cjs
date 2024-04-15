'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var assert = require('assert');
var ffmpeg = require('fluent-ffmpeg');
var _ = require('lodash');
var AsyncLock = require('async-lock');
var genericPool = require('generic-pool');
var path = require('path');
var fs = require('fs-extra');
var uniqid = require('uniqid');
var EventEmitter = require('eventemitter3');
var os = require('os');
var crypto = require('crypto');
var stream = require('stream');
var url = require('url');
var CRC32 = require('crc-32');
var got = require('got');
var util$1 = require('util');
require('colors');
var dateFns = require('date-fns');
var puppeteer = require('puppeteer-core');
var ____MP4Box = require('mp4box');
var browsers = require('@puppeteer/browsers');
var cliProgress = require('cli-progress');
var ffmpegPath = require('ffmpeg-static');
var ffprobeStatic = require('ffprobe-static');

var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
/** 支持的格式枚举 */
const SUPPORT_FORMAT = [
    "mp4",
    "webm"
];

/** 视频编码器 */
const VIDEO_ENCODER = {
    CPU: {
        /**
         * 使用CPU进行H264软编码
         * 适配容器：mp4
         * 建议更改使用其它硬编码方案加速合成
         */
        H264: "libx264",
        /**
         * 使用CPU进行H265软编码
         * 适配容器：mp4
         * 建议更改使用其它硬编码方案加速合成
         */
        H265: "libx265",
        /**
         * 使用CPU进行VP8软编码
         * 适配容器：webm
         * 建议更改使用其它硬编码方案加速合成
         */
        VP8: "libvpx",
        /**
         * 使用CPU进行VP9软编码
         * 适配容器：webm
         * 建议更改使用其它硬编码方案加速合成
         */
        VP9: "libvpx-vp9"
    },
    INTEL: {
        /** 
         * 使用Intel核显或独显的QSV加速H264编码
         * 适配容器：mp4
         */
        H264: "h264_qsv",
        /**
         * 使用Intel核显或独显的QSV加速H265编码
         * 适配容器：mp4
         */
        H265: "hevc_qsv",
        /** 
         * 使用Intel核显或独显的QSV加速VP8编码
         * 适配容器：webm
         */
        VP8: "vp8_qsv",
        /**
         * 使用Intel核显或独显的QSV加速VP9编码
         * 适配容器：webm
         */
        VP9: "vp9_qsv"
    },
    AMD: {
        /**
         * 使用AMD核显或独显的AMF加速H264编码
         * 适配容器：mp4
         */
        H264: "h264_amf",
        /**
         * 使用AMD核显或独显的AMF加速H265编码
         * 适配容器：mp4
         */
        H265: "h265_amf"
    },
    NVIDIA: {
        /** 
         * 使用Nvidia显卡NVENC加速H264编码
         * 适配容器：mp4
         * 通过 https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix-new 查看支持情况
         */
        H264: "h264_nvenc",
        /** 
         * 使用Nvidia显卡NVENC加速H265编码
         * 适配容器：mp4
         * 通过 https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix-new 查看支持情况
         */
        H265: "hevc_nvenc"
    },
    OMX: {
        /**
         * 使用OpenOMX加速H264编码，可能适用于嵌入式平台
         * 适配容器：mp4
         */
        H264: "h264_omx"
    },
    V4L2: {
        /**
         * 使用V4L2加速H264编码
         * 适配容器：mp4
         */
        H264: "h264_v4l2m2m"
    },
    VAAPI: {
        /**
         * 使用VAAPI加速H264编码
         * 适配容器：mp4
         */
        H264: "h264_vaapi",
        /**
         * 使用VAAPI加速H265编码
         * 适配容器：mp4
         */
        H265: "hevc_vaapi",
        /**
         * 使用VAAPI加速VP8编码
         * 适配容器：webm
         */
        VP8: "vp8_vaapi",
        /**
         * 使用VAAPI加速VP9编码
         * 适配容器：webm
         */
        VP9: "vp9_vaapi"
    },
    VIDEOTOOLBOX: {
        /**
         * 使用VIDEOTOOLBOX加速H264编码，适用于MAC
         * 适配容器：mp4
         */
        H264: "h264_videotoolbox",
        /**
         * 使用VIDEOTOOLBOX加速H265编码，适用于MAC
         * 适配容器：mp4
         */
        H265: "hevc_videotoolbox"
    }
};

/** 视频编码器映射 */
const VIDEO_ENCODER_MAP = Object.values(VIDEO_ENCODER).reduce((map, o) => {
    Object.entries(o).forEach(([type, codec]) => {
        !map[type] && (map[type] = []);
        map[type].push(codec);
    });
    return map;
}, {});

const AUDIO_ENCODER = {
    /**
     * AAC音频编码
     * 建议使用此编码
     */
    AAC: "aac",
    /**
     * OPUS音频编码
     */
    OPUS: "libopus"
};

/** 音频编码器映射 */
const AUDIO_ENCODER_MAP = Object.values(AUDIO_ENCODER).reduce((map, o) => {
    Object.entries(o).forEach(([type, codec]) => {
        !map[type] && (map[type] = []);
        map[type].push(codec);
    });
    return map;
}, {});

/** 比特流过滤器 */
const BITSTREAM_FILTER = {
    H264: "h264_mp4toannexb",
    H265: "hevc_mp4toannexb",
    VP9: "vp9_superframe"
};

/** 视频格式映射到支持的视频编码器 */
const FORMAT_VIDEO_ENCODER_MAP = {
    "mp4": [
        VIDEO_ENCODER.CPU.H264,
        VIDEO_ENCODER.CPU.H265,
        VIDEO_ENCODER.INTEL.H264,
        VIDEO_ENCODER.INTEL.H265,
        VIDEO_ENCODER.AMD.H264,
        VIDEO_ENCODER.AMD.H265,
        VIDEO_ENCODER.NVIDIA.H264,
        VIDEO_ENCODER.NVIDIA.H265,
        VIDEO_ENCODER.OMX.H264,
        VIDEO_ENCODER.V4L2.H264,
        VIDEO_ENCODER.VAAPI.H264,
        VIDEO_ENCODER.VAAPI.H265,
        VIDEO_ENCODER.VIDEOTOOLBOX.H264,
        VIDEO_ENCODER.VIDEOTOOLBOX.H265
    ],
    "webm": [
        VIDEO_ENCODER.CPU.VP8,
        VIDEO_ENCODER.CPU.VP9,
        VIDEO_ENCODER.INTEL.VP9,
        VIDEO_ENCODER.VAAPI.VP8,
        VIDEO_ENCODER.VAAPI.VP9
    ],
    "ts": [
        VIDEO_ENCODER.CPU.H264,
        VIDEO_ENCODER.CPU.H265,
        VIDEO_ENCODER.INTEL.H264,
        VIDEO_ENCODER.INTEL.H265,
        VIDEO_ENCODER.AMD.H264,
        VIDEO_ENCODER.AMD.H265,
        VIDEO_ENCODER.NVIDIA.H264,
        VIDEO_ENCODER.NVIDIA.H265,
        VIDEO_ENCODER.OMX.H264,
        VIDEO_ENCODER.V4L2.H264,
        VIDEO_ENCODER.VAAPI.H264,
        VIDEO_ENCODER.VAAPI.H265,
        VIDEO_ENCODER.VIDEOTOOLBOX.H264,
        VIDEO_ENCODER.VIDEOTOOLBOX.H265
    ]
};

/** 视频格式映射到支持的音频编码器 */
const FORMAT_AUDIO_ENCODER_MAP = {
    "mp4": [
        AUDIO_ENCODER.AAC,
        AUDIO_ENCODER.OPUS
    ],
    "webm": [
        AUDIO_ENCODER.AAC,
        AUDIO_ENCODER.OPUS
    ]
};

/**
 * Xfade转场滤镜
 * 请参考：http://trac.ffmpeg.org/wiki/Xfade
 */
const TRANSITION = {
    /** 淡入淡出 */
    FADE: "fade",
    /** 从右向左擦除 */
    WIPE_LEFT: "wipeleft",
    /** 从左向右擦除 */
    WIPE_RIGHT: "wiperight",
    /** 从下往上擦除 */
    WIPE_UP: "wipeup",
    /** 从上往下擦除 */
    WIPE_DOWN: "wipedown",
    /** 从右向左滑动 */
    SLIDE_LEFT: "slideleft",
    /** 从左向右滑动 */
    SLIDE_RIGHT: "slideright",
    /** 从下往上滑动 */
    SLIDE_UP: "slideup",
    /** 从上往下滑动 */
    SLIDE_DOWN: "slidedown",
    /** 圆形裁剪过渡 */
    CIRCLE_CROP: "circlecrop",
    /** 矩形裁剪过渡 */
    RECT_CROP: "rectcrop",
    /** 色块过渡 */
    DISTANCE: "distance",
    /** 黑色渐变淡入淡出 */
    FADE_BLACK: "fadeblack",
    /** 白色渐变淡入淡出 */
    FADE_WHITE: "fadewhite",
    /** 雷达扫描 */
    RADIAL: "radial",
    /** 从右向左平滑过渡 */
    SMOOTH_LEFT: "smoothleft",
    /** 从左向右平滑过渡 */
    SMOOTH_RIGHT: "smoothright",
    /** 从下向上平滑过渡 */
    SMOOTH_UP: "smoothup",
    /** 从上向下平滑过渡 */
    SMOOTH_DOWN: "smoothdown",
    /** 圆形开放过渡 */
    CIRCLE_OPEN: "circleopen",
    /** 圆形闭合过渡 */
    CIRCLE_CLOSE: "circleclose",
    /** 垂直方向开放过渡 */
    VERT_OPEN: "vertopen",
    /** 垂直方向闭合过渡 */
    VERT_CLOSE: "vertclose",
    /** 水平方向开放过渡 */
    HORZ_OPEN: "horzopen",
    /** 水平方向闭合过渡 */
    HORZ_CLOSE: "horzclose",
    /** 溶解过渡 */
    DISSOLVE: "dissolve",
    /** 像素化过渡 */
    PIXELIZE: "pixelize",
    /** 右下对角线过渡 */
    DIAGL: "diagtl",
    /** 左下对角线过渡 */
    DIAGTR: "diagtr",
    /** 右上对角线过渡 */
    DIAGBL: "diagbl",
    /** 左上对角线过渡 */
    DIAGBR: "diagbr",
    /** 水平从右向左百叶窗过渡 */
    SLICE_LEFT: "hlslice",
    /** 水平从左向右百叶窗过渡 */
    SLICE_RIGHT: "hrslice",
    /** 垂直从右向左百叶窗过渡 */
    SLICE_UP: "vuslice",
    /** 垂直从右向左百叶窗过渡 */
    SLICE_DOWN: "vdslice",
    /** 高速模糊效果 */
    HBLUR: "hblur",
    /** 灰度渐变 */
    FADE_GRAYS: "fadegrays",
    /** 从右下向左上擦除 */
    WIPE_TL: "wipetl",
    /** 从左下向右上角擦除 */
    WIPE_TR: "wipetr",
    /** 从右上向左下擦除 */
    WIPE_BL: "wipebl",
    /** 从左上向右下擦除 */
    WIPE_BR: "wipebr",
    /** 水平挤压 */
    SQUEEZEH: "squeezeh",
    /** 垂直挤压 */
    SQUEEZEV: "squeezev",
    /** 放大过渡 */
    ZOOM_IN: "zoomin",
    /** 从右向左扫过 */
    WIND_LEFT: "hlwind",
    /** 从左向右扫过 */
    WIND_RIGHT: "hrwind",
    /** 从下向上扫过 */
    WIND_UP: "vuwind",
    /** 从上向下扫过 */
    WIND_DOWN: "vdwind",
    /** 从右向左覆盖 */
    COVER_LEFT: "coverleft",
    /** 从左向右覆盖 */
    COVER_RIGHT: "coverright",
    /** 从下向上覆盖 */
    COVER_UP: "coverup",
    /** 从上向下覆盖 */
    COVER_DOWN: "coverdown",
    /** 从右向左揭开 */
    REVEAL_LEFT: "revealleft",
    /** 从左向右揭开 */
    REVEAL_RIGHT: "revealright",
    /** 从下向上揭开 */
    REVEAL_UP: "revealup",
    /** 从上向下揭开 */
    REVEAL_DOWN: "revealdown"
};

var globalConfig = {

    /**
     * WebVideoCreator调试日志
     * 
     * 开启后将输出一些WVC的调试日志
     * 
     * @type {boolean}
     */
    debug: false,

    /**
     * 浏览器版本
     * 
     * 指定WVC使用的Chrome浏览器版本
     * 
     * @type {string}
     */
    browserVersion: null,

    /**
     * 浏览器无头开关
     * 
     * 建议保持开启，如果关闭请确保开启兼容渲染模式否则无法渲染，仅用于调试画面
     * 
     * @type {boolean}
     */
    browserHeadless: true,

    /**
     * 浏览器帧率限制开关
     * 
     * 默认开启，关闭帧率限制可以提高渲染效率并支持高于60fps的动画，但这会关闭GPU垂直同步可能导致画面撕裂或其它问题
     * 
     * @type {boolean}
     */
    browserFrameRateLimit: true,

    /**
     * 浏览器Debug开关
     * 
     * 开启后将输出浏览器的运行日志
     * 如果您想看页面的日志，请设置视频参数的consoleLog为true，而不是这个
     * 
     * @type {boolean}
     */
    browserDebug: false,
    
    /**
     * FFmpeg Debug开关
     * 
     * 开启后将输出每一条执行的ffmpeg命令
     * 
     * @type {boolean}
     */
    ffmpegDebug: false,

    /**
     * ffmpeg可执行文件路径
     * 
     * 设置后将禁用内部的ffmpeg-static，建议您默认使用内部的FFmpeg以确保功能完整性
     * 
     * @type {string}
     */
    ffmpegExecutablePath: null,

    /**
     * ffprobe可执行文件路径
     * 
     * 设置后将禁用内部的ffprobe-static，建议您默认使用内部的ffprobe以确保功能完整性
     * 
     * @type {string}
     */
    ffprobeExecutablePath: null,

    /**
     * 浏览器GPU加速开关
     * 
     * 建议开启提高渲染性能，如果您没有GPU设备或遭遇了诡异的渲染问题则可以关闭它
     * 
     * @type {boolean}
     */
    browserUseGPU: true,

    /**
     * 浏览器是否使用Angle作为渲染后端
     * 
     * 建议开启增强渲染跨平台兼容性和性能
     * 
     * @type {boolean}
     */
    browserUseAngle: true,

    /**
     * 是否禁用浏览器使用共享内存
     * 
     * 当/dev/shm分区较小时建议开启此选项
     */
    browserDisableDevShm: false,
    
    /**
     * 浏览器可执行文件路径
     * 
     * 设置后将禁用内部的浏览器，建议您默认使用内部的浏览器以确保功能完整性
     * 
     * @type {string}
     */
    browserExecutablePath: null,

    /**
     * 浏览器启动超时时间（毫秒）
     * 
     * 设置等待浏览器启动超时时间
     * 
     * @type {number}
     */
    browserLaunchTimeout: 30000,

    /**
     * 浏览器协议通信超时时间（毫秒）
     * 
     * 设置CDP协议通信超时时间
     * 
     * @type {number}
     */
    browserProtocolTimeout: 180000,

    /**
     * 是否允许不安全的上下文
     * 
     * 默认禁用，开启后能够导航到不安全的URL
     * 但由于不安全上下文限制，将无法在页面中使用动态图像和内嵌视频
     */
    allowUnsafeContext: false,

    /**
     * 兼容渲染模式
     * 
     * 渲染效率降低40%
     * 
     * 不建议启用，启用后将禁用HeadlessExperimental.beginFrame API调用改为普通的Page.screenshot
     * 这会导致渲染性能下降，当你遭遇下面错误的时候可以尝试开启它
     * TargetCloseError: Protocol error (HeadlessExperimental.beginFrame): Target closed
     * 
     * @type {boolean}
     */
    compatibleRenderingMode: false,

    /**
     * 资源池可并行的最小浏览器实例数量
     * 
     * @type {number}
     */
    numBrowserMin: 1,

    /**
     * 资源池可并行的最大浏览器实例数量
     * 
     * @type {number}
     */
    numBrowserMax: 5,

    /**
     * 浏览器实例可并行的最小页面实例数量
     * 
     * @type {number}
     */
    numPageMin: 1,

    /**
     * 浏览器实例可并行的最大页面实例数量
     * 
     * @type {number}
     */
    numPageMax: 5,

    /**
     * 访问页面时的用户UA
     * 
     * @type {string}
     */
    userAgent: null,

    /**
     * 捕获帧图质量（0-100）
     * 
     * 仅frameFormat为jpeg时有效
     * 
     * @type {number}
     */
    frameQuality: 80,
    
    /**
     * 帧图格式（jpeg/png）
     * 
     * 建议使用jpeg，png捕获较为耗时
     * 
     * @type {string}
     */
    frameFormat: "jpeg",

    /**
     * BeginFrame捕获图像超时时间（毫秒）
     * 
     * @type {number}
     */
    beginFrameTimeout: 5000,

    /**
     * 全局MP4格式的视频编码器
     * 
     * 默认使用libx264软编码器，建议根据您的硬件选用合适的硬编码器加速合成
     * 
     * @type {string}
     */
    mp4Encoder: VIDEO_ENCODER.CPU.H264,

    /**
     * 全局WEBM格式的视频编码器
     * 
     * 默认使用libvpx软编码器，建议根据您的硬件选用合适的硬编码器加速合成
     * 
     * @type {string}
     */
    webmEncoder: VIDEO_ENCODER.CPU.VP8,

    /**
     * 全局音频编码器
     * 
     * 建议采用默认的aac编码器
     * 
     * @type {string}
     */
    audioEncoder: AUDIO_ENCODER.AAC

};

class Task extends EventEmitter {

    /** 任务类型枚举 */
    static TYPE = {
        /** 未知类型任务 */
        UNKOWN: Symbol("UNKNOWN"),
        /** 下载类型任务 */
        DOWNLOAD: Symbol("DOWNLOAD"),
        /** 处理类型任务 */
        PROCESS: Symbol("PROCESS")
    };
    /** 任务状态枚举 */
    static STATE = {
        /** 等待调度 */
        WAITING: Symbol("WAITING"),
        /** 执行中 */
        EXECUTING: Symbol("EXECUTING"),
        /** 已完成 */
        COMPLETED: Symbol("COMPLETED")
    }

    /** @type {string} - 任务ID */
    id = uniqid();
    /** @type {Task.TYPE} - 任务类型 */
    type = Task.TYPE.UNKOWN;
    /** @type {Task.STATE} - 任务状态 */
    state = Task.STATE.WAITING;
    /** @type {number} - 任务进度 */
    progress = 0;
    /** @type {number} - 重试次数 */
    retryCount;
    /** @type {number} - 重试延迟（毫秒） */
    retryDelay;
    /** @type {Error[]} - 错误列表 */
    errors = [];
    /** @type {number} - 启动时间点（毫秒） */
    startupTime;
    /** @type {number} - 错误事件点（毫秒） */
    errorTime;
    /** @type {number} - 创建时间点（毫秒） */
    createTime = performance.now();
    /** @type {boolean} - 是否忽略本地缓存 */
    ignoreCache;
    /** @type {string} @protected 临时路径 */
    tmpDirPath = path.resolve("tmp/preprocessor/");

    /**
     * 构造函数
     * 
     * @param {Object} options - 任务选项
     * @param {number} [retryCount=2] - 重试次数
     * @param {number} [retryDelay=1000] - 重试延迟
     * @param {boolean} [options.ignoreCache=false] - 是否忽略本地缓存
     */
    constructor(options) {
        super();
        assert(_.isObject(options), "Task options must be Object");
        const { retryCount, retryDelay, ignoreCache } = options;
        assert(_.isUndefined(retryCount) || _.isFinite(retryCount), "retryCount must be number");
        assert(_.isUndefined(retryDelay) || _.isFinite(retryDelay), "retryDelay must be number");
        assert(_.isUndefined(ignoreCache) || _.isBoolean(ignoreCache), "ignoreCache must be boolean");
        this.retryCount = _.defaultTo(retryCount, 2);
        this.retryDelay = _.defaultTo(retryDelay, 1000);
        this.ignoreCache = ignoreCache || false;
    }

    /**
     * 启动任务
     */
    start() {
        this.#setState(Task.STATE.EXECUTING);
        this.startupTime = performance.now();
    }

    /**
     * 更新进度
     * 
     * @param {number} value - 进度值
     */
    _updateProgress(value) {
        this.progress = Math.min(value, 100);
        this.emit("progress", this.progress);
    }

    /**
     * 发射已完成事件
     * 
     * @protected
     */
    _emitCompleted(result) {
        this.#setState(Task.STATE.COMPLETED);
        this.emit("completed", result);
    }

    /**
     * 发送错误事件
     * 
     * @protected
     * @param {Error} err - 错误对象
     */
    _emitError(err) {
        this.errors.push(err);
        this.errorTime = performance.now();
        if (this.errors.length <= this.retryCount) {
            // 设置为等待状态，等待调度
            this.#setState(Task.STATE.WAITING);
            return;
        }
        return this.emit("error", err);
    }

    #setState(state) {
        assert(_.isSymbol(state), "state must be Symbol");
        this.state = state;
    }

    canStart() {
        if (!this.isWaiting())
            return false;
        if (this.errors.length > this.retryCount)
            return false;
        if (performance.now() < this.errorTime + this.retryDelay)
            return false;
        return true;
    }

    canRemove() {
        if (this.isCompleted())
            return true;
        if (this.errors.length > this.retryCount)
            return true;
        return false;
    }

    isWaiting() {
        return this.state == Task.STATE.WAITING;
    }

    isExecuting() {
        return this.state == Task.STATE.EXECUTING;
    }

    isCompleted() {
        return this.state == Task.STATE.COMPLETED;
    }

}

/**
 * 日志文本格式化
 */
class LogText {

    /** @type {string} - 日志级别 */
    level;
    /** @type {string} - 日志文本 */
    text;
    /** @type {string} - 日志来源 */
    source;
    /** @type {Date} - 日志产生时间点 */
    time = new Date();

    constructor(level, ...params) {
        this.level = level;
        // 使用util.format将参数格式化为文本
        this.text = util$1.format.apply(null, params);
        // 获取调用栈顶信息
        this.source = this.#getStackTopCodeInfo();
    }

    /**
     * 获取调用栈顶部信息
     * 
     * @returns {Object} - 调用信息对象
     */
    #getStackTopCodeInfo() {
        const unknownInfo = { name: "unknown", codeLine: 0, codeColumn: 0 };
        const stackArray = new Error().stack.split("\n");
        const text = stackArray[4];
        if (!text)
            return unknownInfo;
        const match = text.match(/at (.+) \((.+)\)/) || text.match(/at (.+)/);
        if (!match || !util$1.isString(match[2] || match[1]))
            return unknownInfo;
        const temp = match[2] || match[1];
        const _match = temp.match(/([a-zA-Z0-9_\-\.]+)\:(\d+)\:(\d+)$/);
        if (!_match)
            return unknownInfo;
        const [, scriptPath, codeLine, codeColumn] = _match;
        return {
            name: scriptPath ? scriptPath.replace(/.js$/, "") : "unknown",
            path: scriptPath || null,
            codeLine: parseInt(codeLine || 0),
            codeColumn: parseInt(codeColumn || 0)
        };
    }

    /**
     * 导出为日志内容
     * 
     * @returns {string} - 日志内容
     */
    toString() {
        return `[${dateFns.format(this.time, "yyyy-MM-dd HH:mm:ss.SSS")}][${this.level}][${this.source.name}<${this.source.codeLine},${this.source.codeColumn}>] ${this.text}`;
    }

}

var logger = {

    /**
     * 打印成功日志
     * 
     * @param  {...any} params - 参数
     */
    success(...params) {
        const content = new LogText("success", ...params).toString();
        console.info(content["green"]);
    },

    /**
     * 打印信息日志
     * 
     * @param  {...any} params - 参数
     */
    info(...params) {
        const content = new LogText("info", ...params).toString();
        console.info(content["brightCyan"]);
    },

    /**
     * 打印普通日志
     * 
     * @param  {...any} params - 参数
     */
    log(...params) {
        const content = new LogText("log", ...params).toString();
        console.info(content["white"]);
    },

    /**
     * 打印内部调试日志
     * 
     * @param  {...any} params - 参数
     */
    _debug(...params) {
        const content = new LogText("debug", ...params).toString();
        console.info(content["white"]);
    },

    /**
     * 打印调试日志
     * 
     * @param  {...any} params - 参数
     */
    debug(...params) {
        if (!globalConfig.debug)
            return;
        const content = new LogText("debug", ...params).toString();
        console.info(content["white"]);
    },

    /**
     * 打印警告日志
     * 
     * @param  {...any} params - 参数
     */
    warn(...params) {
        const content = new LogText("warn", ...params).toString();
        console.info(content["brightYellow"]);
    },

    /**
     * 打印错误日志
     * 
     * @param  {...any} params - 参数
     */
    error(...params) {
        const content = new LogText("error", ...params).toString();
        console.info(content["brightRed"]);
    }

};

// 项目根路径
const ROOT_PATH = path.dirname(url.fileURLToPath((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.src || new URL('index.cjs', document.baseURI).href))));

var util = {

    /**
     * 拼接路径
     * 
     * @param {string} relativePath - 相对路径
     * @returns {string} - 绝对路径
     */
    rootPathJoin(relativePath) {
        if (!relativePath)
            return relativePath;
        // 如果是绝对路径则直接返回绝对路径
        if (path.isAbsolute(relativePath))
            return relativePath;
        return path.join(ROOT_PATH, relativePath);
    },

    /**
     * 检查远端资源是否可访问
     * 
     * @param {string} url - 资源URL
     * @param {string[]|RegExp[]} [mimesLimit] - MIME类型限制列表
     */
    async checkRemoteResource(url, mimesLimit) {
        url = url.replace("localhost", "127.0.0.1");
        const response = await got.head(url);
        if (response.statusCode >= 400)
            throw new Error(`Resource ${url} request error: [${response.statusCode || 0}] ${response.statusMessage || "Unknown"}`);
        const mime = response.headers["content-type"] || "unknown";
        const size = response.headers["content-length"];
        if (_.isArray(mimesLimit)) {
            let matched;
            for (let limit of mimesLimit) {
                if (limit == mime || (_.isRegExp(limit) && limit.test(mime))) {
                    matched = true;
                    break;
                }
            }
            if (!matched)
                throw new Error(`Resource ${url} content type ${mime} is not supported`);
        }
        return {
            mime,
            size: size ? Number(size) : null
        };
    },

    /**
     * 获取媒体元数据
     * 
     * @param {string} source - 媒体来源
     * @returns {Object} - 媒体元数据
     */
    async getMediaMetadata(source) {
        if (!await fs.pathExists(source) && !this.isURL(source))
            throw new Error(`media source ${source} not found`);
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(source, (err, metadata) => {
                if (err) return reject(err);
                resolve(metadata);
            });
        });
    },

    /**
     * 获取媒体视频编码器
     * 
     * @param {string} source - 媒体来源
     * @param {boolean} allStreams - 是否返回所有流的编码器信息
     * @returns 
     */
    async getMediaVideoCodecName(source, allStreams = false) {
        const { streams } = await this.getMediaMetadata(source);
        const videoStreams = streams.filter(v => v.codec_type === "video");
        if (!videoStreams.length)
            throw new Error(`${source} video stream not found`);
        return allStreams ? videoStreams.map(stream => stream.codec_name) : videoStreams[0].codec_name;
    },

    /**
     * 获取媒体时长
     * 
     * @param {string} source - 媒体来源
     * @returns {number} - 媒体时长（毫秒）
     */
    async getMediaDuration(source) {
        const metadata = await this.getMediaMetadata(source);  //获取媒体信息
        if (!metadata || !metadata.format || !_.isFinite(metadata.format.duration))
            throw new Error(`Media ${source} duration invalid`);
        return (metadata.format.duration || 0) * 1000;
    },

    /**
     * 检查媒体是否具有透明通道
     * 
     * @param {string} source - 媒体来源
     * @returns {boolean} = 是否具有透明通道
     */
    async checkMediaHasAplhaChannel(source) {
        const metadata = await this.getMediaMetadata(source);  //获取媒体信息
        if (!metadata || !metadata.streams || !metadata.streams[0])
            throw new Error(`Media ${source} streams invalid`);
        if (!metadata.streams[0].tags || !metadata.streams[0].tags["ALPHA_MODE"])
            return false;
        return Number(metadata.streams[0].tags["ALPHA_MODE"]) > 0;
    },

    /**
     * 判断是否URL
     * 
     * @param {string} value - 检查值
     * @returns {boolean} - 是否URL
     */
    isURL(value) {
        return !_.isUndefined(value) && /^(http|https)/.test(value);
    },

    /**
     * 判断是否处于Linux平台
     * 
     * @returns {boolean} - 是否Linux平台
     */
    isLinux() {
        return os.platform() !== "win32";
    },

    /**
     * 判断是否写入流
     * 
     * @param {*} value - 值
     * @returns {boolean} - 是否写入流
     */
    isWriteStream(value) {
        return value && (value instanceof stream.Writable || "writable" in value || value.writable);
    },

    /**
     * 拼接URL
     * 
     * @param  {...any} values - 字符串
     * @returns {string} - URL
     */
    urlJoin(...values) {
        let url = "";
        for (let i = 0; i < values.length; i++)
            url += `${i > 0 ? "/" : ""}${values[i].replace(/^\/*/, "").replace(/\/*$/, "")}`;
        return url;
    },

    /**
     * URL转本地路径
     * 
     * @param {string} value - URL
     * @returns {string} - 路径
     */
    urlToPath(value) {
        const { host, pathname } = new URL(value);
        return `${host.replace(/\.|:/g, "_")}${pathname.replace(/\.\.|:|@|\?|\*/g, "_")}`
    },

    /**
     * 获取URL扩展名
     * 
     * @param {string} value - URL
     * @returns {string} - 扩展名
     */
    getURLExtname(value) {
        if (!this.isURL(value))
            return null;
        const { pathname } = new URL(value);
        const extname = path.extname(pathname);
        if (!extname)
            return null;
        return extname.substring(1);
    },

    /**
     * 获取路径扩展名
     * 
     * @param {string} value - 路径
     * @returns {string} - 扩展名
     */
    getPathExtname(value) {
        return path.extname(value).substring(1);
    },

    /**
     * 毫秒转H:m:s.ms时间字符串
     * 
     * @param {number} milliseconds - 毫秒
     * @returns {string} - 时间字符串
     */
    millisecondsToHmss(milliseconds) {
        if (_.isString(milliseconds)) return milliseconds;
        milliseconds = parseInt(milliseconds);
        const sec = Math.floor(milliseconds / 1000);
        const hours = Math.floor(sec / 3600);
        const minutes = Math.floor((sec - hours * 3600) / 60);
        const seconds = sec - hours * 3600 - minutes * 60;
        const ms = milliseconds % 60000 - seconds * 1000;
        return `${hours > 9 ? hours : "0" + hours}:${minutes > 9 ? minutes : "0" + minutes}:${seconds > 9 ? seconds : "0" + seconds}.${ms}`;
    },

    /**
     * 将时长转换为总帧数
     * 
     * @param {number} duration - 时长
     * @param {number} fps - 帧率
     * @returns {number} - 总帧数
     */
    durationToFrameCount(duration, fps) {
        assert(_.isFinite(duration), "duration must be number");
        assert(_.isFinite(fps), "fps must be number");
        return Math.floor(duration / 1000 * fps)
    },

    /**
     * 将总帧数转换为时长
     * 
     * @param {number} frameCount - 总帧数
     * @param {number} fps - 帧率
     * @returns {number} - 时长
     */
    frameCountToDuration(frameCount, fps) {
        assert(_.isFinite(frameCount), "duration must be number");
        assert(_.isFinite(fps), "fps must be number");
        return frameCount / fps;
    },

    /**
     * 从视频捕获截图
     * 
     * @param {string} source - 输入源
     * @param {string} dest - 输出源
     * @param {number} timemark - 时间点
     */
    async captureScreenshot(source, dest, timemark) {
        return new Promise((resolve, reject) => {
            ffmpeg(source)
                .screenshot({
                    folder: path.dirname(dest),
                    filename: path.basename(dest),
                    timemarks: [this.millisecondsToHmss(timemark)]
                })
                .once("error", reject)
                .once("end", resolve);
        });
    },

    /**
     * 从视频分离音轨
     * 
     * @param {string} source 视频来源
     * @param {string} dest 输出目标
     * @param {Object} [options] - 输出选项
     * @param {number} [options.seekStart] - 裁剪开始时间点
     * @param {number} [options.seekEnd] - 裁剪结束时间点
     * @param {string} [options.audioEncoder="aac"] - 音频编码器
     * @param {string} [options.audioBitrate="320k"] - 音频码率
     * @param {string} [options.audioSampleRate="44100"] - 音频采样率
     * @param {string} [options.outputFormat="aac"] - 输出格式
     * @returns {boolean} - 是否已分离音频
     */
    async separateVideoAudioTrack(source, dest, options = {}) {
        assert(_.isObject(options), "options must be Object");
        const { seekStart, seekEnd, audioEncoder = "libmp3lame", audioBitrate = "320k",
            audioSampleRate = "44100", outputFormat = "mp3" } = options;
        assert(_.isString(source), "source must be an url or path");
        assert(_.isString(dest), "dest must be an path");
        const acodeer = ffmpeg();
        acodeer.addInput(source);
        _.isFinite(seekStart) &&
            acodeer.addInputOption("-ss", this.millisecondsToHmss(seekStart));
        _.isFinite(seekEnd) &&
            seekEnd > (seekStart || 0) &&
            acodeer.addInputOption("-to", this.millisecondsToHmss(seekEnd));
        let audioDuration;
        if (_.isFinite(seekEnd))
            audioDuration = seekEnd - (seekStart || 0);
        else
            audioDuration = (await this.getMediaDuration(source)) - (seekStart || 0);
        return new Promise((resolve, reject) => {
            acodeer
                .addInputOption("-vn")
                .complexFilter("[0]apad")
                .setDuration(audioDuration / 1000)
                .audioCodec(audioEncoder)
                .audioBitrate(audioBitrate)
                .outputOptions(`-ar ${audioSampleRate}`)
                .toFormat(outputFormat)
                .output(dest)
                .once("start", cmd => this.ffmpegLog(cmd))
                .once("error", (err) => {
                    fs.removeSync(dest);
                    // 无音频返回false
                    if (
                        err.message.indexOf("no streams") != -1 ||
                        err.message.indexOf("not contain") != -1
                    )
                        return resolve(false);
                    reject(err);
                })
                .once("end", () => resolve(true))
                .run();
        });
    },

    /**
     * 音频裁剪
     * 
     * @param {string} source 视频来源
     * @param {string} dest 输出目标
     * @param {Object} [options] - 输出选项
     * @param {number} [options.seekStart] - 裁剪开始时间点
     * @param {number} [options.seekEnd] - 裁剪结束时间点
     */
    async clipAudio(source, dest, options = {}) {
        assert(_.isObject(options), "options must be Object");
        const { seekStart = 0, seekEnd } = options;
        assert(_.isString(source), "source must be an url or path");
        assert(_.isString(dest), "dest must be an path");
        const acodeer = ffmpeg();
        acodeer.addInput(source);
        _.isFinite(seekStart) &&
            acodeer.addInputOption("-ss", this.millisecondsToHmss(seekStart));
        _.isFinite(seekEnd) &&
            seekEnd > (seekStart || 0) &&
            acodeer.addInputOption("-to", this.millisecondsToHmss(seekEnd));
        return new Promise((resolve, reject) => {
            acodeer
                .audioCodec("copy")
                .output(dest)
                .once("start", cmd => this.ffmpegLog(cmd))
                .once("error", reject)
                .once("end", resolve)
                .run();
        });
    },

    /**
     * RGB色值转十六进制字符串
     * 
     * @param {number} r - 红色
     * @param {number} g - 绿色
     * @param {number} b - 蓝色
     * @returns {string} - 十六进制字符串
     */
    rgbToHex(r, g, b) {
        return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    },

    /**
     * 十六进制字符串转RGB色值
     * 
     * @param {string} hex - 十六进制字符串
     * @returns {Array} RGB色值数组
     */
    hexToRgb(hex) {
        const value = parseInt(hex.replace(/^#/, ""), 16);
        return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    },

    /**
     * MD5计算
     * 
     * @param {string} value - 值
     * @returns {string} - MD5值
     */
    md5(value) {
        return crypto.createHash("md5").update(value).digest("hex");
    },

    /**
     * CRC32计算
     * 
     * @param {string|Buffer} value - 值
     * @returns {number} - CRC32值
     */
    crc32(value) {
        return _.isBuffer(value) ? CRC32.buf(value) : CRC32.str(value);
    },

    /**
     * 下载资源
     * 
     * @param {string} url - 资源URL
     * @param {string|writable} dest - 写入目标
     * @param {Object} [options] - 下载选项
     * @param {Function} [options.onProgress] - 下载进度回调
     * @param {string[]|RegExp[]} [options.mimesLimit] - 限制MIME类型列表
     * @param {string[]} [options.retryFetchs=0] - 重试次数
     * @param {string[]} [options.retryDelay=500] - 重试延迟
     */
    async download(url, dest, options = {}) {
        const { onProgress, mimesLimit, retryFetchs = 0, retryDelay = 500, _retryCount = 0, ..._options } = options;
        assert(this.isURL(url), `url ${url} is invalid`);
        url = url.replace("localhost", "127.0.0.1");
        let writeStream;
        if (_.isString(dest))
            writeStream = fs.createWriteStream(dest);
        else if (this.isWriteStream(dest))
            writeStream = dest;
        else
            throw new Error("Download dest is invalid");
        const { size } = await this.checkRemoteResource(url, mimesLimit);
        const response = await got.stream(url, _options);
        return await new Promise((resolve, reject) => {
            if (onProgress) {
                let writtenSize = 0;
                response.on("data", (chunk) => {
                    writtenSize += chunk.length;
                    onProgress(Math.floor(writtenSize / size * 100)); // 更新进度
                });
            }
            response.on("end", resolve);
            response.on("error", err => {
                if (retryFetchs > _retryCount) {
                    setTimeout(() => {
                        resolve(this.download(url, dest, { ...options, _retryCount: _retryCount + 1 }));
                    }, retryDelay);
                }
                else
                    reject(new Error(`Download resource ${url} failed: ${err.message}`));
            });
            response.pipe(writeStream);
        });
    },

    /**
     * FFmpeg日志汇总输出
     * 
     * @param {string} log - 日志内容
     */
    ffmpegLog(log) {
        if(!globalConfig.ffmpegDebug)
            return;
        logger._debug(log);
    }

};

const downloadLock$1 = new AsyncLock();

class DownloadTask extends Task {

    /** @type {Task.TYPE} - 任务类型 */
    type = Task.TYPE.DOWNLOAD;
    /** @type {string} - 资源URL */
    url;

    /**
     * 构造函数
     * 
     * @param {Object} options - 任务选项
     * @param {string} options.url - 资源URL
     * @param {number} [options.retryFetchs=2] - 重试次数
     * @param {number} [options.retryDelay=1000] - 重试延迟
     */
    constructor(options) {
        super(options);
        const { url, retryFetchs } = options;
        assert(util.isURL(url), "url is invalid");
        assert(_.isUndefined(retryFetchs) || _.isFinite(retryFetchs), "retryFetchs must be number");
        this.url = url;
        this.retryCount = retryFetchs || 2;
    }

    /**
     * 启动任务
     */
    start(multiDownload = false) {
        super.start();
        if (!multiDownload) {
            this._downloadFile(this.url)
                .then(filePath => this._emitCompleted({ filePath }))
                .catch(err => this._emitError(err));
        }
    }

    /**
     * 下载文件
     *
     * @protected
     * @param {string} url 资源URL
     * @param {string[]|RegExp[]} [mimesLimit] - MIME类型限制列表
     */
    async _downloadFile(url, mimesLimit) {
        const filePath = path.join(this.tmpDirPath, util.urlToPath(url));
        await downloadLock$1.acquire(util.crc32(url), async () => {
            if (!this.ignoreCache && await fs.pathExists(filePath)) return filePath;
            await fs.ensureDir(path.dirname(filePath), { recursive: true });
            const writeStream = fs.createWriteStream(`${filePath}.tmp`);
            await util.download(url, writeStream, {
                onProgress: v => this._updateProgress(v),
                mimesLimit
            });
            await fs.move(`${filePath}.tmp`, filePath);
        });
        return filePath;
    }

}

class ProcessTask extends Task {

    /** @type {Task.TYPE} - 任务类型 */
    type = Task.TYPE.PROCESS;

    /**
     * 启动任务
     */
    start() {
        super.start();
        this.process()
            .then(result => this._emitCompleted(result))
            .catch(err => this._emitError(err));
    }

    /**
     * 处理
     */
    async process() {
        logger.warn("Process task nothing to do...");
        return null;
    }

}

/**
 * 预处理器
 */
class Preprocessor {

    /** @type {number} - 并行下载数量 */
    parallelDownloads;
    /** @type {number} - 并行处理数量 */
    parallelProcess;
    /** @type {DownloadTask[]} - 下载队列 */
    #downloadQueue = [];
    /** @type {ProcessTask} - 处理队列 */
    #processQueue = [];
    /** @type {Function} - 下载队列恢复回调函数 */
    #downloadQueueResumeCallback;
    /** @type {Function} - 处理队列恢复回调函数 */
    #processQueueResumeCallback;
    /** @type {DownloadTask[]} - 下载任务列表 */
    downloadTasks = [];
    /** @type {ProcessTask[]} - 处理任务列表 */
    processTasks = [];

    /**
     * 构造函数
     * 
     * @param {Object} options - 预处理器选项
     * @param {number} [options.parallelDownloads=10] - 并行下载数量
     * @param {number} [options.parallelProcess=10] - 并行处理数量
     */
    constructor(options) {
        assert(_.isObject(options), "VideoPreprocessor options must be Object");
        const { parallelDownloads, parallelProcess } = options;
        assert(_.isUndefined(parallelDownloads) || _.isFinite(parallelDownloads), "parallelDownloads must be number");
        assert(_.isUndefined(parallelProcess) || _.isFinite(parallelProcess), "parallelProcess must be number");
        this.parallelDownloads = _.defaultTo(parallelDownloads, 10);
        this.parallelProcess = _.defaultTo(parallelProcess, 10);
        // 调度下载队列
        this.#dispatchDownloadQueue();
        // 调度处理队列
        this.#dispatchProcessQueue();
        // 调度任务
        this.#dispatchTasks();
    }

    /**
     * 发起处理
     * 
     * @param {Object} options - 任务选项
     */
    async process(options) {
        const downloadTask = this.createDownloadTask(options);
        const downloadResult = await new Promise((resolve, reject) => {
            downloadTask
                .once("completed", resolve)
                .once("error", reject);
        });
        const processTask = this.createProcessTask({ ...downloadResult, ...options });
        const result = await new Promise((resolve, reject) => {
            processTask
                .once("completed", resolve)
                .once("error", reject);
        });
        return result;
    }

    /**
     * 创建下载任务
     * 
     * @param {Object} options - 下载任务选项
     * @returns {DownloadTask} - 下载任务对象
     */
    createDownloadTask(options) {
        const task = new DownloadTask(options);
        this.addDownloadTask(task);
        return task;
    }

    /**
     * 添加处理任务
     * 
     * @param {Task} task - 任务对象
     */
    addDownloadTask(task) {
        assert(task instanceof DownloadTask, "task must be DownloadTask instance");
        this.#downloadQueue.push(task);
        if (this.#downloadQueueResumeCallback) {
            const fn = this.#downloadQueueResumeCallback;
            this.#downloadQueueResumeCallback = null;
            fn();
        }
    }

    /**
     * 创建处理任务
     * 
     * @param {Object} options - 处理任务选项
     * @returns {ProcessTask} - 处理任务对象
     */
    createProcessTask(options) {
        const task = new ProcessTask(options);
        this.addProcessTask(task);
        return task;
    }

    /**
     * 添加处理任务
     * 
     * @param {Task} task - 任务对象
     */
    addProcessTask(task) {
        assert(task instanceof ProcessTask, "task must be ProcessTask instace");
        this.#processQueue.push(task);
        if (this.#processQueueResumeCallback) {
            const fn = this.#processQueueResumeCallback;
            this.#processQueueResumeCallback = null;
            fn();
        }
    }

    /**
     * 调度下载队列
     */
    #dispatchDownloadQueue() {
        (async () => {
            const task = this.#downloadQueue.shift();
            if (!task || this.downloadTasks.length >= this.parallelDownloads) {
                await new Promise(resolve => this.#downloadQueueResumeCallback = resolve);
                return this.#dispatchDownloadQueue();
            }
            this.downloadTasks.push(task);
            this.#dispatchDownloadQueue();
        })()
            .catch(err => logger.error(err));
    }

    /**
     * 调度处理队列
     */
    #dispatchProcessQueue() {
        (async () => {
            const task = this.#processQueue.shift();
            if (!task || this.processTasks.length >= this.parallelProcess) {
                await new Promise(resolve => this.#processQueueResumeCallback = resolve);
                return this.#dispatchProcessQueue();
            }
            this.processTasks.push(task);
            this.#dispatchProcessQueue();
        })()
            .catch(err => logger.error(err));
    }

    /**
     * 任务调度
     */
    #dispatchTasks() {
        try {
            this.downloadTasks = this.downloadTasks.filter(task => {
                if (task.canRemove())
                    return false;
                if (task.canStart())
                    task.start();
                return true;
            });
            if (this.downloadTasks.length < this.parallelDownloads) {
                if (this.#downloadQueueResumeCallback) {
                    const fn = this.#downloadQueueResumeCallback;
                    this.#downloadQueueResumeCallback = null;
                    fn();
                }
            }
            this.processTasks = this.processTasks.filter(task => {
                if (task.canRemove())
                    return false;
                if (task.canStart())
                    task.start();
                return true;
            });
            if (this.processTasks.length < this.parallelProcess) {
                if (this.#processQueueResumeCallback) {
                    const fn = this.#processQueueResumeCallback;
                    this.#processQueueResumeCallback = null;
                    fn();
                }
            }
            setTimeout(this.#dispatchTasks.bind(this), 0);
        }
        catch (err) {
            logger.error(err);
        }
    }

}

new AsyncLock();

class VideoDownloadTask extends DownloadTask {

    /** @type {DownloadTask.TYPE} - 任务类型 */
    type = DownloadTask.TYPE.DOWNLOAD;
    /** @type {string} - 资源URL */
    url;
    /** @type {string} - 蒙版资源URL */
    maskUrl;

    /**
     * 构造函数
     * 
     * @param {Object} options - 任务选项
     * @param {string} options.url - 资源URL
     * @param {string} [options.maskUrl] - 蒙版资源URL
     * @param {number} [options.retryFetchs=2] - 重试次数
     * @param {number} [options.retryDelay=1000] - 重试延迟
     */
    constructor(options) {
        super(options);
        const { url, maskUrl, retryFetchs } = options;
        assert(util.isURL(url), "url is invalid");
        assert(_.isUndefined(maskUrl) || _.isString(maskUrl), "maskUrl is invalid");
        assert(_.isUndefined(retryFetchs) || _.isFinite(retryFetchs), "retryFetchs must be number");
        this.url = url;
        this.maskUrl = maskUrl;
        this.retryCount = retryFetchs || 2;
    }

    /**
     * 启动任务
     */
    start() {
        if (!this.maskUrl)
            super.start();
        else {
            super.start(true);
            const mimesLimit = [
                /^video\//,
                /^application\/octet-stream/
            ];
            Promise.all([
                this._downloadFile(this.url, mimesLimit),
                this._downloadFile(this.maskUrl, mimesLimit)
            ])
                .then(([filePath, maskFilePath]) => this._emitCompleted({ filePath, maskFilePath }))
                .catch(err => this._emitError(err));
        }
    }

}

const downloadLock = new AsyncLock();

/**
 * 音频
 */
class Audio {

    /** @type {number} - 音频ID */
    id;
    /** @type {string} - 音频路径 */
    path;
    /** @type {string} - 音频URL */
    url;
    /** @type {number} - 起始时间点（毫秒） */
    startTime;
    /** @type {number} - 结束时间点（毫秒） */
    endTime;
    /** @type {number} - 时长 */
    duration;
    /** @type {boolean|number} - 是否循环播放 */
    loop;
    /** @type {number} - 音量（0-100） */
    volume;
    /** @type {number} - 裁剪起始时间点（毫秒） */
    seekStart;
    /** @type {number} - 裁剪结束实际点（毫秒） */
    seekEnd;
    /** @type {number} - 淡入时长（毫秒） */
    fadeInDuration;
    /** @type {number} - 淡出时长（毫秒 */
    fadeOutDuration;
    /** @type {number} - 重试拉取次数 */
    retryFetchs;
    /** @type {boolean} - 是否忽略本地缓存 */
    ignoreCache;
    /** @type {string} - 临时路径 */
    tmpDirPath = path.resolve("tmp/preprocessor/");
    /** @type {Promise} - 加载承诺 */
    #loadPromise;

    /**
     * 构造函数
     * 
     * @param {Object} options - 音频选项
     * @param {number} [options.id] - 音频ID
     * @param {string} [options.path] - 音频路径
     * @param {string} [options.url] - 音频URL
     * @param {number} [options.startTime=0] - 起始时间点（毫秒）
     * @param {number} [options.endTime] - 结束时间点（毫秒）
     * @param {boolean} [options.loop=false] - 是否循环播放
     * @param {number} [options.volume=100] - 音量（0-100）
     * @param {number} [options.seekStart=0] - 裁剪起始时间点（毫秒）
     * @param {number} [options.seekEnd] - 裁剪结束实际点（毫秒）
     * @param {number} [options.fadeInDuration] - 淡入时长（毫秒）
     * @param {number} [options.fadeOutDuration] - 淡出时长（毫秒）
     * @param {number} [options.retryFetchs=2] - 重试拉取次数
     * @param {boolean} [options.ignoreCache=false] - 是否忽略本地缓存
     */
    constructor(options) {
        assert(_.isObject(options), "addAudio options must be object");
        const { id, path: _path, url, startTime, endTime, loop, volume, seekStart, seekEnd,
            fadeInDuration, fadeOutDuration, retryFetchs, ignoreCache } = options;
        assert(_.isUndefined(id) || _.isFinite(id), "Audio id must be number");
        assert(_.isString(_path) || _.isString(url), "Audio path or url must be string");
        assert(_.isUndefined(startTime) || _.isFinite(startTime), "Audio startTime must be number");
        assert(_.isUndefined(endTime) || _.isFinite(endTime), "Audio endTime must be number");
        assert(_.isUndefined(loop) || _.isBoolean(loop), "Audio loop must be boolean");
        assert(_.isUndefined(volume) || _.isFinite(volume), "Audio volume must be number");
        assert(_.isUndefined(seekStart) || _.isFinite(seekStart), "Audio seekStart must be number");
        assert(_.isUndefined(seekEnd) || _.isFinite(seekEnd), "Audio seekEnd must be number");
        assert(_.isUndefined(fadeInDuration) || _.isFinite(fadeInDuration), "Audio fadeInDuration must be number");
        assert(_.isUndefined(fadeOutDuration) || _.isFinite(fadeOutDuration), "Audio fadeOutDuration must be number");
        assert(_.isUndefined(retryFetchs) || _.isFinite(retryFetchs), "Audio retryFetchs must be number");
        assert(_.isUndefined(ignoreCache) || _.isBoolean(ignoreCache), "Audio fadeOutDuration must be boolean");
        this.id = id;
        this.path = _.isString(_path) ? path.resolve(_path) : _path;
        this.url = url;
        this.startTime = _.defaultTo(startTime, 0);
        this.endTime = endTime;
        this.loop = _.defaultTo(loop, false);
        this.volume = _.defaultTo(volume, 100);
        this.seekStart = _.defaultTo(seekStart, 0);
        this.seekEnd = seekEnd;
        this.fadeInDuration = fadeInDuration;
        this.fadeOutDuration = fadeOutDuration;
        this.retryFetchs = _.defaultTo(retryFetchs, 2);
        this.ignoreCache = _.defaultTo(ignoreCache, false);
    }

    /**
     * 资源加载
     */
    async load() {
        if (this.#loadPromise)
            return this.#loadPromise;
        this.#loadPromise = (async () => {
            if (this.path) {
                if (!await fs.pathExists(this.path))
                    throw new Error(`Audio source ${this.path} not exists`);
                if (!(await fs.stat(this.path)).isFile())
                    throw new Error(`Audio source ${this.path} must be file`);
            }
            else if (this.url)
                this.path = await this.#downloadFile(this.url);
            this.duration = await util.getMediaDuration(this.path);
            if (this.endTime > 0 && this.startTime > this.endTime)
                throw new Error(`Audio startTime (${this.startTime}) > endTime (${this.endTime})`);
            if (this.seekEnd && this.seekStart > this.seekEnd)
                throw new Error(`Audio seekStart (${this.seekStart}) > seekEnd (${this.seekEnd})`);
        })();
        return this.#loadPromise;
    }

    /**
     * 下载文件
     *
     * @param {string} url 资源URL
     */
    async #downloadFile(url) {
        const filePath = path.join(this.tmpDirPath, util.urlToPath(url));
        await downloadLock.acquire(util.crc32(url), async () => {
            if (!this.ignoreCache && await fs.pathExists(filePath)) return filePath;
            await fs.ensureDir(path.dirname(filePath), { recursive: true });
            const writeStream = fs.createWriteStream(`${filePath}.tmp`);
            await util.download(url, writeStream, {
                mimesLimit: [
                    /^audio\//,
                    /^application\/octet-stream/
                ],
                retryFetchs: this.retryFetchs
            });
            await fs.move(`${filePath}.tmp`, filePath);
        });
        return filePath;
    }

}

// 处理异步锁
const processLock = new AsyncLock();

class VideoProcessTask extends ProcessTask {

    /** @type {string} - 视频文件路径 */
    filePath;
    /** @type {string} - 视频格式 */
    format;
    /** @type {string} - 蒙版视频文件路径 */
    maskFilePath;
    /** @type {string} - 音频文件路径 */
    audioFilePath;
    /** @type {string} - 已转码文件路径 */
    transcodedFilePath;
    /** @type {number} - 开始播放时间点（毫秒） */
    startTime;
    /** @type {number} - 结束播放时间点（毫秒） */
    endTime;
    /** @type {number} - 音频ID */
    audioId;
    /** @type {number} - 裁剪开始时间点（毫秒） */
    seekStart;
    /** @type {number} - 裁剪结束时间点（毫秒） */
    seekEnd;
    /** @type {number} - 视频音频淡入时长（毫秒） */
    fadeInDuration;
    /** @type {number} - 视频音频淡出时长（毫秒） */
    fadeOutDuration;
    /** @type {boolean} - 是否自动播放 */
    autoplay;
    /** @type {number} - 视频音量 */
    volume;
    /** @type {boolean} - 是否循环播放 */
    loop;
    /** @type {boolean} - 是否静音 */
    muted;
    /** @type {string} - 视频编码器 */
    videoEncoder;

    /**
     * 构造函数
     * 
     * @param {Object} options - 任务选项
     * @param {string} options.filePath - 视频文件路径
     * @param {string} options.format - 视频格式
     * @param {number} options.startTime - 开始播放时间点（毫秒）
     * @param {number} options.endTime - 结束播放时间点（毫秒）
     * @param {number} options.audioId - 音频ID
     * @param {number} [options.seekStart=0] - 裁剪开始时间点（毫秒）
     * @param {number} [options.seekEnd] - 裁剪结束时间点（毫秒）
     * @param {number} [options.fadeInDuration] - 视频音频淡入时长（毫秒）
     * @param {number} [options.fadeOutDuration] - 视频音频淡出时长（毫秒）
     * @param {boolean} [options.autoplay] - 是否自动播放
     * @param {number} [options.volume] - 视频音量
     * @param {boolean} [options.loop=false] - 是否循环播放
     * @param {boolean} [options.muted=false] - 是否静音
     * @param {string} [options.videoEncoder="libx264"] - 视频编码器
     * @param {number} [options.retryFetchs=2] - 重试次数
     * @param {number} [options.retryDelay=1000] - 重试延迟
     */
    constructor(options) {
        super(options);
        const { filePath, maskFilePath, format, startTime, endTime, audioId, seekStart, seekEnd, fadeInDuration, fadeOutDuration, autoplay, volume, loop, muted, videoEncoder } = options;
        assert(_.isString(filePath), "filePath must be string");
        assert(_.isString(format) && ["mp4", "webm"].includes(format), "format must be string");
        assert(_.isFinite(startTime), "startTime must be number");
        assert(_.isFinite(endTime), "endTime must be number");
        assert(_.isFinite(audioId), "audioId must be number");
        assert(_.isUndefined(maskFilePath) || _.isString(maskFilePath), "maskFilePath must be string");
        assert(_.isUndefined(seekStart) || _.isFinite(seekStart), "seekStart must be number");
        assert(_.isUndefined(seekEnd) || _.isFinite(seekEnd), "seekEnd must be number");
        assert(_.isUndefined(fadeInDuration) || _.isFinite(fadeInDuration), "fadeInDuration must be number");
        assert(_.isUndefined(fadeOutDuration) || _.isFinite(fadeOutDuration), "fadeOutDuration must be number");
        assert(_.isUndefined(autoplay) || _.isBoolean(autoplay), "autoplay must be number");
        assert(_.isUndefined(volume) || _.isFinite(volume), "volume must be number");
        assert(_.isUndefined(loop) || _.isBoolean(loop), "loop must be number");
        assert(_.isUndefined(muted) || _.isBoolean(muted), "muted must be number");
        assert(_.isUndefined(videoEncoder) || _.isString(videoEncoder), "videoEncoder must be string");
        this.filePath = filePath;
        this.maskFilePath = maskFilePath;
        this.format = format;
        this.startTime =startTime;
        this.endTime = endTime;
        this.audioId = audioId;
        this.seekStart = _.defaultTo(seekStart, 0);
        this.seekEnd = seekEnd;
        this.fadeInDuration = fadeInDuration;
        this.fadeOutDuration = fadeOutDuration;
        this.autoplay = autoplay;
        this.volume = _.defaultTo(volume, 100);
        this.loop = _.defaultTo(loop, false);
        this.muted = _.defaultTo(muted, false);
        this.videoEncoder = _.defaultTo(videoEncoder, VIDEO_ENCODER.CPU.H264);
    }

    /**
     * 处理视频
     */
    async process() {
        // 非静音音频需分离音频文件
        !this.muted && await this.#separateAudioFile();
        if (this.format == "webm") {
            // 视频转码为H264
            await this.#videoTranscoding();
            // 检查是否具有透明通道
            const hasAlphaChannel = await util.checkMediaHasAplhaChannel(this.filePath);
            // 具备透明通道将分离出蒙版视频
            hasAlphaChannel && await this.#videoMaskExtract();
        }
        let buffer;
        let maskBuffer = null;
        // 当存在seek时进行裁剪
        if(this.hasClip) {
            buffer = await this.#videoClip(this.outputFilePath);
            if(this.maskFilePath)
                maskBuffer = await this.#videoClip(this.maskFilePath);
        }
        else {
            buffer = await fs.readFile(this.outputFilePath);
            if(this.maskFilePath)
                maskBuffer = await fs.readFile(this.maskFilePath);
        }
        return {
            // 添加到合成器的音频对象
            audio: this.audioFilePath ? new Audio({
                id: this.audioId,
                path: this.audioFilePath,
                startTime: this.startTime,
                endTime: this.endTime,
                seekStart: this.seekStart,
                seekEnd: this.seekEnd,
                fadeInDuration: this.fadeInDuration,
                fadeOutDuration: this.fadeOutDuration,
                volume: this.volume,
                loop: this.loop
            }) : null,
            // video_preprocess响应回传到浏览器的数据
            buffer: this.#packData({
                buffer,
                maskBuffer,
                hasMask: !!this.maskFilePath,
                hasAudio: this.hasAudio,
                hasClip: this.hasClip
            })
        }
    }

    /**
     * 视频裁剪
     */
    async #videoClip(filePath) {
        const cliper = ffmpeg(filePath);
        let seekEnd = this.seekEnd;
        const duration = (seekEnd || Infinity) - (this.seekStart || 0);
        const endTime = this.startTime + duration;
        if(endTime != Infinity && endTime > this.endTime)
            seekEnd = seekEnd - (endTime - this.endTime);
        this.seekStart && cliper.addInputOption("-ss", util.millisecondsToHmss(this.seekStart));
        seekEnd && cliper.addInputOption("-to", util.millisecondsToHmss(this.seekEnd));
        const buffers = [];
        const stream$1 = new stream.PassThrough();
        const receivePromise = new Promise((resolve, reject) => {
            stream$1.on("data", data => buffers.push(data));
            stream$1.once("error", reject);
            stream$1.once("end", () => resolve(Buffer.concat(buffers)));
        });
        await new Promise((resolve, reject) => {
            cliper
                .addOutputOption(`-c:v ${this.videoEncoder}`)
                .addOutputOption("-an")
                .addOutputOption("-crf 18")
                .addOutputOption("-movflags frag_keyframe+empty_moov")
                .toFormat("mp4")
                .once("error", reject)
                .once("end", resolve)
                .pipe(stream$1, { end: true });
        });
        return await receivePromise;
    }

    /**
     * 透明视频蒙版提取
     */
    async #videoMaskExtract() {
        return await processLock.acquire(`videoMaskExtract-${util.crc32(this.filePath)}`, async () => {
            const maskFilePath = `${this.filePath}_mask.mp4`;
            if (!this.ignoreCache && await fs.pathExists(maskFilePath)) {
                this.maskFilePath = maskFilePath;
                return;
            }
            const videoEncoderName = await util.getMediaVideoCodecName(this.filePath);
            let codec;
            switch (videoEncoderName) {
                case "vp8":
                    codec = "libvpx";
                    break;
                case "vp9":
                    codec = "libvpx-vp9";
                    break;
                default:
                    throw new Error(`Video file ${this.filePath} codec name ${videoEncoderName} is not supported`);
            }
            await new Promise((resolve, reject) => {
                ffmpeg(this.filePath)
                    .addInputOption(`-c:v ${codec}`)
                    .videoFilter("alphaextract")
                    .addOutputOption(`-c:v ${this.videoEncoder}`)
                    .addOutputOption("-an")
                    .outputOption("-movflags +faststart")
                    .addOutput(maskFilePath)
                    .once("start", cmd => util.ffmpegLog(cmd))
                    .once("end", resolve)
                    .once("error", err => {
                        fs.removeSync(maskFilePath);
                        reject(err);
                    })
                    .run();
            });
            this.maskFilePath = maskFilePath;
        });
    }

    /**
     * 视频转码
     */
    async #videoTranscoding() {
        return await processLock.acquire(`videoTranscoding-${util.crc32(this.filePath)}`, async () => {
            const transcodedFilePath = `${this.filePath}_transcoded.mp4`;
            if (!this.ignoreCache && await fs.pathExists(transcodedFilePath)) {
                this.transcodedFilePath = transcodedFilePath;
                return;
            }
            const videoEncoderName = await util.getMediaVideoCodecName(this.filePath);
            let codec;
            switch (videoEncoderName) {
                case "vp8":
                    codec = "libvpx";
                    break;
                case "vp9":
                    codec = "libvpx-vp9";
                    break;
                default:
                    throw new Error(`Video file ${this.filePath} codec name ${videoEncoderName} is not supported`);
            }
            await new Promise((resolve, reject) => {
                ffmpeg(this.filePath)
                    .addInputOption(`-c:v ${codec}`)
                    .addOutputOption(`-c:v ${this.videoEncoder}`)
                    .addOutputOption("-an")
                    .addOutputOption("-crf 18")
                    .outputOption("-movflags +faststart")
                    .addOutput(transcodedFilePath)
                    .once("start", cmd => util.ffmpegLog(cmd))
                    .once("end", resolve)
                    .once("error", err => {
                        fs.removeSync(this.filePath);
                        reject(err);
                    })
                    .run();
            });
            this.transcodedFilePath = transcodedFilePath;
        });
    }

    /**
     * 分离视频的音频
     */
    async #separateAudioFile() {
        return await processLock.acquire(`separateAudioFile-${util.crc32(this.filePath)}`, async () => {
            const audioFormat = "mp3";
            const audioFilePath = `${this.filePath}.${audioFormat}`;
            if (this.ignoreCache || !await fs.pathExists(audioFilePath)) {
                const hasAudioTrack = await util.separateVideoAudioTrack(this.filePath, audioFilePath, {
                    audioEncoder: "libmp3lame",
                    outputFormat: audioFormat
                });
                if (hasAudioTrack)
                    this.audioFilePath = audioFilePath;
            }
            else
                this.audioFilePath = audioFilePath;
        });
    }

    /**
     * 封装数据
     * 将对象封装为Buffer才能回传浏览器页面处理
     * 
     * @param {Object} data - 数据对象
     * @returns {Buffer} - 已封装Buffer
     */
    #packData(data) {
        const obj = {};
        const buffers = [];
        let bufferOffset = 0;
        for (let key in data) {
            if (_.isBuffer(data[key])) {
                obj[key] = ["buffer", bufferOffset, bufferOffset + data[key].length];
                bufferOffset += data[key].length;
                buffers.push(data[key]);
            }
            else
                obj[key] = data[key];
        }
        const objBuffer = Buffer.from(JSON.stringify(obj));
        buffers.unshift(objBuffer);
        buffers.unshift(Buffer.from(`${objBuffer.length}!`));
        return Buffer.concat(buffers);
    }

    get outputFilePath() {
        return this.transcodedFilePath || this.filePath;
    }

    /**
     * 是否包含音频
     */
    get hasAudio() {
        return !!this.audioFilePath;
    }

    /**
     * 是否裁剪
     */
    get hasClip() {
        return this.seekStart > 0 || this.seekEnd > 0;
    }

}

class VideoConfig {

    /** @type {string} - 视频URL */
    url;
    /** @type {string} - 蒙版视频URL */
    maskUrl;
    /** @type {number} - 开始播放时间点（毫秒） */
    startTime;
    /** @type {number} - 结束播放时间（毫秒） */
    endTime;
    /** @type {number} - 内部音频ID */
    audioId;
    /** @type {number} - 裁剪开始时间点（毫秒） */
    seekStart;
    /** @type {number} - 裁剪结束时间点（毫秒） */
    seekEnd;
    /** @type {number} - 音频淡入时长（毫秒） */
    fadeInDuration;
    /** @type {number} - 音频淡出时长（毫秒） */
    fadeOutDuration;
    /** @type {boolean} - 是否自动播放 */
    autoplay;
    /** @type {number} - 视频音量（0-100） */
    volume;
    /** @type {boolean} - 是否循环播放 */
    loop;
    /** @type {boolean} - 是否静音 */
    muted;
    /** @type {number} - 重试下载次数 */
    retryFetchs;
    /** @type {boolean} - 是否忽略本地缓存 */
    ignoreCache;

    /**
     * 构造函数
     * 
     * @param {Object} options - 视频配置选项
     * @param {string} options.url - 视频URL
     * @param {number} options.startTime - 开始播放时间点（毫秒）
     * @param {number} options.endTime - 结束播放时间点（毫秒）
     * @param {string} [options.maskUrl] - 蒙版视频URL
     * @param {string} [options.format] - 视频格式（mp4/webm）
     * @param {number} [options.audioId] - 内部音频ID
     * @param {number} [options.seekStart] - 裁剪开始时间点（毫秒）
     * @param {number} [options.seekEnd] - 裁剪结束时间点（毫秒）
     * @param {number} [options.fadeInDuration] - 音频淡入时长（毫秒）
     * @param {number} [options.fadeOutDuration] - 音频淡出时长（毫秒）
     * @param {boolean} [options.autoplay] - 是否自动播放
     * @param {number} [options.volume] - 视频音量
     * @param {boolean} [options.loop] - 是否循环播放
     * @param {boolean} [options.muted] - 是否静音
     * @param {boolean} [options.retryFetchs] - 重试下载次数
     * @param {boolean} [options.ignoreCache] - 是否忽略本地缓存
     */
    constructor(options) {
        assert(_.isObject(options), "VideoConfig options must be Object");
        const { url, maskUrl, format, startTime, endTime, audioId, seekStart, seekEnd, fadeInDuration, fadeOutDuration, autoplay, volume, loop, muted, retryFetchs, ignoreCache } = options;
        assert(util.isURL(url), "url is invalid");
        assert(_.isFinite(startTime), "startTime must be number");
        assert(_.isFinite(endTime), "endTime must be number");
        assert(_.isUndefined(maskUrl) || util.isURL(maskUrl), "maskUrl is invalid");
        assert(_.isUndefined(format) || _.isString(format), "format mudt be string");
        assert(_.isUndefined(audioId) || _.isFinite(audioId), "audioId must be number");
        assert(_.isUndefined(seekStart) || _.isFinite(seekStart), "seekStart must be number");
        assert(_.isUndefined(seekEnd) || _.isFinite(seekEnd), "seekEnd must be number");
        assert(_.isUndefined(fadeInDuration) || _.isFinite(fadeInDuration), "fadeInDuration must be number");
        assert(_.isUndefined(fadeOutDuration) || _.isFinite(fadeOutDuration), "fadeOutDuration must be number");
        assert(_.isUndefined(autoplay) || _.isBoolean(autoplay), "autoplay must be number");
        assert(_.isUndefined(volume) || _.isFinite(volume), "volume must be number");
        assert(_.isUndefined(loop) || _.isBoolean(loop), "loop must be boolean");
        assert(_.isUndefined(muted) || _.isBoolean(muted), "muted must be boolean");
        this.url = url;
        this.maskUrl = maskUrl;
        this.format = _.defaultTo(format, util.getURLExtname(this.url));
        this.startTime = startTime;
        this.endTime = endTime;
        this.audioId = audioId;
        this.seekStart = seekStart;
        this.seekEnd = seekEnd;
        this.fadeInDuration = fadeInDuration;
        this.fadeOutDuration = fadeOutDuration;
        this.autoplay = autoplay;
        this.volume = volume;
        this.loop = loop;
        this.muted = muted;
        this.retryFetchs = retryFetchs;
        this.ignoreCache = ignoreCache;
    }

}

/**
 * 视频预处理器
 */
class VideoPreprocessor extends Preprocessor {

    /** @type {string} - 视频编码器（必须为H264编码器） */
    videoEncoder;
    
    /**
     * 构造函数
     * 
     * @param {Object} options - 预处理器选项
     * @param {number} [options.parallelDownloads=10] - 并行下载数量
     * @param {number} [options.parallelProcess=10] - 并行处理数量
     * @param {string} [optiond.videoEncoder="libx264"] - 视频编码器
     */
    constructor(options) {
        super(options);
        const { videoEncoder } = options;
        assert(_.isUndefined(videoEncoder) || _.isString(videoEncoder), "videoEncoder must be string");
        assert(_.isUndefined(videoEncoder) || VIDEO_ENCODER_MAP.H264.includes(videoEncoder), `videoEncoder ${videoEncoder} is not H264 encoder`);
        this.videoEncoder = _.defaultTo(videoEncoder, _.defaultTo(globalConfig.mp4Encoder, VIDEO_ENCODER.CPU.H264));
    }

    /**
     * 发起处理
     * 
     * @param {VideoConfig} config - 视频配置
     */
    async process(config) {
        assert(config instanceof VideoConfig, "process config must be VideoConfig");
        return await super.process(config);
    }

    /**
     * 创建视频下载任务
     * 
     * @param {Object} options - 下载任务选项
     * @returns {VideoDownloadTask} - 下载任务对象
     */
    createDownloadTask(options) {
        const task = new VideoDownloadTask(options);
        this.addDownloadTask(task);
        return task;
    }

    /**
     * 创建视频处理任务
     * 
     * @param {Object} options - 处理任务选项
     * @returns {VideoProcessTask} - 处理任务对象
     */
    createProcessTask(options) {
        const task = new VideoProcessTask({ ...options, videoEncoder: this.videoEncoder });
        this.addProcessTask(task);
        return task;
    }

}

/**
 * 内部工具包
 * 
 * 被用于浏览器环境内
 */
var innerUtil = () => ({

    /**
     * 简易的断言
     * 
     * @param {any} value - 值
     * @param {string} message - 断言消息
     */
    assert(value, message) {
        if (value === true) return;
        throw (message instanceof Error ? message : new Error(message));
    },

    /**
     * 判断是否对象
     * 
     * @param {any} value - 值
     * @returns {boolean} - 是否对象
     */
    isObject(value) {
        return value instanceof Object;
    },

    /**
     * 判断是否函数
     * 
     * @param {any} value - 值
     * @returns {boolean} - 是否函数
     */
    isFunction(value) {
        return value instanceof Function;
    },

    /**
     * 判断是否Uint8Array
     * 
     * @param {any} value - 值
     * @returns {boolean} - 是否Unit8Array
     */
    isUint8Array(value) {
        return value instanceof Uint8Array;
    },

    /**
     * 判断是否未定义
     * 
     * @param {any} value - 值
     * @returns {boolean} - 是否未定义
     */
    isUndefined(value) {
        return value === undefined;
    },

    /**
     * 判断是否为null
     * 
     * @param {any} value - 值
     * @returns {boolean} - 是否为null
     */
    isNull(value) {
        return value === null;
    },

    /**
     * 判断是否未定义或为null
     * 
     * @param {any} value - 值
     * @returns {boolean} - 是否未定义或为null
     */
    isNil(value) {
        return this.isUndefined(value) || this.isNull(value);
    },

    /**
     * 是否为字符串值
     * 
     * @param {any} value - 值
     * @returns {boolean} - 是否字符串
     */
    isString(value) {
        return typeof value == "string";
    },

    /**
     * 判断是否数字值
     * 
     * @param {any} value - 值
     * @returns {boolean} - 是否数字
     */
    isNumber(value) {
        return !isNaN(value);
    },

    /**
     * 判断是否布尔值
     * 
     * @param {any} value - 值
     * @returns {boolean} - 是否布尔值
     */
    isBoolean(value) {
        return value === true || value === false;
    },

    /**
     * 判断是否错误对象
     * 
     * @param {any} value - 值
     * @returns {boolean} - 是否错误对象
     */
    isError(value) {
        return value instanceof Error;
    },

    /**
     * 默认值赋值
     * 
     * @param {any} value - 值
     * @param {any} defaultValue - 默认值
     * @returns {any} - 值
     */
    defaultTo(value, defaultValue) {
        if(this.isNil(value))
            return defaultValue;
        return value;
    }

});

const ____util$3 = innerUtil();

/**
 * SVG动画
 */
class SvgAnimation {

    /** @type {number} - 开始时间点（毫秒） */
    startTime;
    /** @type {number} - 结束时间点（毫秒） */
    endTime;
    /** @type {SVGSVGElement} - SVG元素 */
    target;
    /** @type {number} - 重复索引 */
    repetitionIndex = 0;
    /** @type {boolean} - 是否已销毁 */
    destoryed = false;

    /**
     * 构造函数
     * 
     * @param {Object} options - SVG动画选项
     * @param {SVGSVGElement} options.target - SVG元素
     * @param {number} options.startTime - 开始播放时间点（毫秒）
     * @param {number} options.endTime - 结束播放时间点（毫秒）
     */
    constructor(options) {
        const u = ____util$3;
        u.assert(u.isObject(options), "SvgAnimation options must be Object");
        const { target, startTime, endTime } = options;
        u.assert(target instanceof SVGSVGElement, "target must be SVGSVGElement");
        u.assert(u.isNumber(startTime), "startTime must be number");
        u.assert(u.isNumber(endTime), "endTime must be number");
        this.target = target;
        this.startTime = startTime;
        this.endTime = endTime;
    }

    /**
     * 判断当前时间点是否可播放
     * 
     * @param {number} time - 时间点
     * @returns {boolean} - 是否可播放
     */
    canPlay(time) {
        // 已销毁不可播放
        if(this.destoryed) return false;
        // 如果当前时间超过元素开始结束时间则判定为不可播放
        const { startTime, endTime = Infinity } = this;
        if (time < startTime || time >= endTime)
            return false;
        return true;
    }

    /**
     * 加载动画
     */
    load() {
        try {
            // 停止SVG动画播放，后续由内部调度渲染
            this.target.pauseAnimations();
            return true;
        }
        catch(err) {
            console.error(err);
            this.destory();
            return false;
        }
    }

    /**
     * 是否准备完毕
     * 
     * @returns {boolean} - 是否准备完毕
     */
    isReady() {
        // SVG动画已暂停时才可以调度
        return this.target.animationsPaused();
    }

    /**
     * 索引帧并绘制
     * 
     * @param {number} time - 索引时间点
     */
    async seek(time) {
        // 设置SVG动画时间点
        this.target.setCurrentTime(time / 1000);
    }

    /**
     * 判断是否可销毁
     * 
     * @returns {boolean} - 是否可销毁
     */
    canDestory(time) {
        // 已销毁则避免重复销毁
        if(this.destoryed) return false;
        // 返回当前时间是否大于结束时间
        return time >= this.endTime;
    }

    /**
     * 销毁SVG动画
     */
    destory() {
        this.target = null;
        this.destoryed = true;
    }

}

/**
 * MP4解复用器
 */
class MP4Demuxer {

    /** @type {ISOFile} - 文件对象 */
    file;
    /** @type {Function} - 配置回调函数 */
    _configCallback;
    /** @type {Function} - 视频块回调函数 */
    _chunkCallback;

    /**
     * 构造函数
     */
    constructor() {
        this.file = ____MP4Box.createFile();
        this.file.onReady = this._onReady.bind(this);
        this.file.onSamples = this._onSamples.bind(this);
    }

    /**
     * 监听配置
     * 
     * @param {Function} fn - 配置回调函数 
     */
    onConfig(fn) {
        this._configCallback = fn;
    }

    /**
     * 监听视频块
     * 
     * @param {Function} fn - 视频块回调函数
     */
    onChunk(fn) {
        this._chunkCallback = fn;
    }

    /**
     * 监听错误
     * 
     * @param {Function} fn - 错误回调函数
     */
    onError(fn) {
        this.file.onError = fn;
    }

    /**
     * 加载文件
     */
    load(buffer) {
        buffer.buffer.fileStart = 0;
        this.file.appendBuffer(buffer.buffer);
        this.file.flush();
    }

    /**
     * 文件已就绪
     * 
     * @param {Object} info - 视频信息
     */
    _onReady(info) {
        // 选取第一条视频轨道
        const track = info.videoTracks[0];
        // 兼容编码映射
        const COMPLATIBLE_CODEC_MAP = {
            "avc1.64003c": "avc1.640033"
        };
        // 配置信息回调用于配置视频解码器
        const duration = (track.movie_duration / track.movie_timescale * 1000) || (track.samples_duration / track.timescale * 1000);
        const fps = Number((track.nb_samples / duration * 1000).toFixed());
        const frameInterval = duration / track.nb_samples;
        this._configCallback && this._configCallback({
            codec: track.codec.startsWith('vp08') ? 'vp8' : (COMPLATIBLE_CODEC_MAP[track.codec] || track.codec),
            codedWidth: track.video ? track.video.width : track.track_width,
            codedHeight: track.video ? track.video.height : track.track_height,
            description: this._getDescription(track),
            bitrate: track.bitrate,
            duration,
            fps,
            frameInterval,
            frameCount: track.nb_samples
        });
        // 开始文件解复用
        this.file.setExtractionOptions(track.id);
        this.file.start();
    }

    /**
     * 获得样本
     * 
     * @param {number} track_id - 轨道ID
     * @param {Object} ref - 引用
     * @param {Object[]} samples - 样本列表
     */
    _onSamples(track_id, ref, samples) {
        // 将所有样本回调
        for (const sample of samples) {
            this._chunkCallback && this._chunkCallback(new EncodedVideoChunk({
                type: sample.is_sync ? "key" : "delta",
                timestamp: 1e6 * sample.cts / sample.timescale,
                duration: 1e6 * sample.duration / sample.timescale,
                data: sample.data
            }));
        }
    }

    /**
     * 获取描述信息
     * 
     * @param {Object} track - 轨道对象
     * @returns {Uint8Array} - 描述信息
     */
    _getDescription(track) {
        const trak = this.file.getTrackById(track.id);
        for (const entry of trak.mdia.minf.stbl.stsd.entries) {
            const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
            if (box) {
                const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
                box.write(stream);
                return new Uint8Array(stream.buffer, 8);
            }
        }
        throw new Error("avcC, hvcC, vpcC, or av1C box not found");
    }

}

const ____util$2 = innerUtil();

/**
 * 视频画布
 */
class VideoCanvas {

    /** @type {string} - 视频URL */
    url;
    /** @type {string} - 蒙版视频URL */
    maskUrl;
    /** @type {string} - 视频格式 */
    format;
    /** @type {number} - 开始播放时间点（毫秒） */
    startTime;
    /** @type {number} - 结束播放时间（毫秒） */
    endTime;
    /** @type {number} - 内部音频ID */
    audioId;
    /** @type {number} - 裁剪开始时间点（毫秒） */
    seekStart;
    /** @type {number} - 裁剪结束时间点（毫秒） */
    seekEnd;
    /** @type {number} - 视频音频淡入时长（毫秒） */
    fadeInDuration;
    /** @type {number} - 视频音频淡出时长（毫秒） */
    fadeOutDuration;
    /** @type {boolean} - 是否强制循环 */
    loop;
    /** @type {number} - 视频音频音量 */
    volume;
    /** @type {boolean} - 是否自动播放 */
    autoplay;
    /** @type {string} - 解码器硬件加速方法提示 */
    hardwareAcceleration;
    /** @type {boolean} - 是否静音 */
    muted;
    /** @type {number} - 重试下载次数 */
    retryFetchs;
    /** @type {boolean} - 是否忽略本地缓存 */
    ignoreCache;
    /** @type {Object} - 视频信息配置对象 */
    config;
    /** @type {Uint8Array} - 视频数据 */
    buffer = null;
    /** @type {Uint8Array} - 蒙版视频数据 */
    maskBuffer = null;
    /** @type {number} - 帧索引 */
    frameIndex = null;
    /** @type {number} - 已解码帧索引 */
    decodedFrameIndex = 0;
    /** @type {number} - 已解码蒙版帧索引 */
    decodedMaskFrameIndex = 0;
    /** @type {number} - 当前播放时间点（毫秒） */
    currentTime = 0;
    /** @type {VideoFrame[]} - 已解码视频帧队列 */
    frames = [];
    /** @type {VideoFrame[]} - 已解码蒙版视频帧队列 */
    maskFrames = [];
    /** @type {HTMLCanvasElement} - 画布元素 */
    canvas = null;
    /** @type {CanvasRenderingContext2D}  - 画布2D渲染上下文*/
    canvasCtx = null;
    /** @type {OffscreenCanvas} - 离屏画布对象 */
    offscreenCanvas;
    /** @type {OffscreenCanvasRenderingContext2D} - 离屏2D画布渲染上下文 */
    offscreenCanvasCtx;
    /** @type {number} - 偏移时间量 */
    offsetTime = 0;
    /** @type {boolean} - 是否被移除 */
    removed = false;
    /** @type {boolean} - 是否已销毁 */
    destoryed = false;
    /** @type {VideoDecoder} - 视频解码器 */
    decoder = null;
    /** @type {VideoDecoder} - 蒙版视频解码器 */
    maskDecoder = null;
    /** @type {number} - 等待视频帧下标 */
    waitFrameIndex = null;
    /** @type {number} - 等待蒙版视频帧下标 */
    waitMaskFrameIndex = null;
    /** @type {Function} - 等待视频帧回调 */
    waitFrameCallback = null;
    /** @type {Function} - 等待蒙版视频帧回调 */
    waitMaskFrameCallback = null;

    /**
     * 构造函数
     * 
     * @param {Object} options - 视频配置选项
     * @param {string} options.url - 视频URL
     * @param {number} options.startTime - 开始播放时间点（毫秒）
     * @param {number} options.endTime - 结束播放时间点（毫秒）
     * @param {number} options.audioId = 内部音频ID
     * @param {string} [options.maskUrl] - 蒙版视频URL
     * @param {string} [options.format] - 视频格式（mp4/webm）
     * @param {number} [options.seekStart=0] - 裁剪开始时间点（毫秒）
     * @param {number} [options.seekEnd] - 裁剪结束时间点（毫秒）
     * @param {number} [options.fadeInDuration] - 视频音频淡入时长（毫秒）
     * @param {number} [options.fadeOutDuration] - 视频音频淡出时长（毫秒）
     * @param {boolean} [options.autoplay] - 是否自动播放
     * @param {number} [options.volume=100] - 视频音频音量（0-100）
     * @param {boolean} [options.loop=false] - 是否循环播放
     * @param {boolean} [options.muted=false] - 是否静音
     * @param {string} [options.hardwareAcceleration="prefer-hardware"] - 解码器硬件加速方法提示
     * @param {boolean} [options.retryFetchs=2] - 重试下载次数
     * @param {boolean} [options.ignoreCache=false] - 是否忽略本地缓存
     */
    constructor(options) {
        const u = ____util$2;
        u.assert(u.isObject(options), "VideoCanvas options must be Object");
        const { url, maskUrl, startTime, endTime, audioId, format, seekStart, seekEnd, fadeInDuration, fadeOutDuration, autoplay, volume, loop, muted, hardwareAcceleration, retryFetchs, ignoreCache } = options;
        u.assert(u.isString(url), "url must be string");
        u.assert(u.isNumber(startTime), "startTime must be number");
        u.assert(u.isNumber(endTime), "endTime must be number");
        u.assert(u.isNumber(audioId), "audioId must be number");
        u.assert(u.isUndefined(maskUrl) || u.isString(maskUrl), "maskUrl must be string");
        u.assert(u.isUndefined(format) || u.isString(format), "format must be string");
        u.assert(u.isUndefined(seekStart) || u.isNumber(seekStart), "seekStart must be number");
        u.assert(u.isUndefined(seekEnd) || u.isNumber(seekEnd), "seekEnd must be number");
        u.assert(u.isUndefined(fadeInDuration) || u.isNumber(fadeInDuration), "fadeInDuration must be number");
        u.assert(u.isUndefined(fadeOutDuration) || u.isNumber(fadeOutDuration), "fadeOutDuration must be number");
        u.assert(u.isUndefined(autoplay) || u.isBoolean(autoplay), "autoplay must be boolean");
        u.assert(u.isUndefined(volume) || u.isNumber(volume), "volume must be number");
        u.assert(u.isUndefined(loop) || u.isBoolean(loop), "loop must be boolean");
        u.assert(u.isUndefined(muted) || u.isBoolean(muted), "muted must be boolean");
        u.assert(u.isUndefined(hardwareAcceleration) || u.isString(hardwareAcceleration), "hardwareAcceleration must be string");
        u.assert(u.isUndefined(retryFetchs) || u.isNumber(retryFetchs), "retryFetchs must be number");
        u.assert(u.isUndefined(ignoreCache) || u.isBoolean(ignoreCache), "ignoreCache must be boolean");
        this.url = url;
        this.maskUrl = maskUrl;
        this.startTime = startTime;
        this.endTime = endTime;
        this.audioId = audioId;
        this.format = format;
        this.seekStart = u.defaultTo(seekStart, 0);
        this.seekEnd = seekEnd;
        this.fadeInDuration = fadeInDuration;
        this.fadeOutDuration = fadeOutDuration;
        this.autoplay = autoplay;
        this.volume = u.defaultTo(volume, 100);
        this.loop = u.defaultTo(loop, false);
        this.muted = u.defaultTo(muted, false);
        this.hardwareAcceleration = u.defaultTo(hardwareAcceleration, "prefer-hardware");
        this.retryFetchs = u.defaultTo(retryFetchs, 2);
        this.ignoreCache = u.defaultTo(ignoreCache, false);
    }

    /**
     * 绑定画布元素
     * 
     * @param {HTMLCanvasElement} canvas - 画布元素
     * @param {Object} [options] - 画布选项
     * @param {boolean} [options.alpha=true] - 是否支持透明通道
     * @param {boolean} [options.imageSmoothingEnabled=true] - 是否开启抗锯齿
     * @param {boolean} [options.imageSmoothingEnabled="high"] - 抗锯齿强度
     */
    bind(canvas, options = {}) {
        const { alpha = true, imageSmoothingEnabled = true, imageSmoothingQuality = "high" } = options;
        this.canvas = canvas;
        this.canvas.____onRemoved = () => {
            ____updateAudioEndTime(this.audioId, captureCtx.currentTime);
            this.removed = true;
        };
        // 获取画布2D上下文
        this.canvasCtx = this.canvas.getContext("2d", {
            // 是否透明通道
            alpha,
            // 设置抗锯齿开关
            imageSmoothingEnabled,
            // 设置抗锯齿强度
            imageSmoothingQuality
        });
    }

    canPlay(time) {
        if (this.destoryed) return;
        const { startTime, endTime } = this;
        // 如果当前时间超过元素开始结束时间则判定未不可播放
        if (time < startTime || time >= endTime)
            return false;
        return true;
    }

    /**
     * 加载视频
     */
    async load() {
        try {
            const datas = await this._fetchData();
            if (!datas) {
                this.destory();
                return false;
            }
            const { buffer, maskBuffer } = datas;
            const { decoder, config } = await this._createDecoder(buffer, {
                onFrame: this._emitNewFrame.bind(this),
                onError: err => console.error(err)
            });
            // 预分配视频帧数组
            this.frames = new Array(config.frameCount);
            this.decoder = decoder;
            this.config = config;
            if (maskBuffer) {
                // 预分配蒙版视频帧数组
                this.maskFrames = new Array(config.frameCount);
                // 初始化用于蒙版抠图的离屏画布
                this._initOffscreenCanvas();
                const {
                    decoder: maskDecoder,
                    config: maskConfig
                } = await this._createDecoder(maskBuffer, {
                    isMask: true,
                    onFrame: this._emitNewMaskFrame.bind(this),
                    onError: err => console.error(err)
                });
                this.maskDecoder = maskDecoder;
                const u = ____util$2;
                u.assert(maskConfig.codedWidth == config.codedWidth, `Mask video codedWidth (${maskConfig.codedWidth}) is inconsistent with the original video codedWidth (${config.codedWidth})`);
                u.assert(maskConfig.codedHeight == config.codedHeight, `Mask video codedHeight (${maskConfig.codedHeight}) is inconsistent with the original video codedHeight (${config.codedHeight})`);
                u.assert(maskConfig.frameCount == config.frameCount, `Mask video frameCount (${maskConfig.frameCount}) is inconsistent with the original video frameCount (${config.frameCount})`);
                u.assert(maskConfig.fps == config.fps, `Mask video fps (${maskConfig.fps}) is inconsistent with the original video fps (${config.fps})`);
            }
            if(this.config.duration <= 0) {
                this.destory();
                return false;
            }
            return true;
        }
        catch (err) {
            console.error(err);
            this.destory();
            return false;
        }
    }

    isReady() {
        return this.decoder && this.decoder.state == "configured";
    }

    async seek(time) {
        // 已销毁不可索引
        if (this.destoryed) return;
        // 计算当前帧的下标
        const frameIndex = Math.floor(time / this.config.frameInterval);
        // 如果当前时间点帧下标和上次一样不做处理
        if (this.frameIndex === frameIndex)
            return;
        // 如果元素被移除播放已结束或画布则跳过
        if (this.removed || (!this.loop && this.isEnd()) || frameIndex >= this.config.frameCount)
            return;
        // console.log(`${frameIndex}/${this.decoder.decodeQueueSize}/${this.config.frameCount}`);
        const frame = await this._acquireFrame(frameIndex);
        // console.log(frameIndex);
        let maskFrame = null;
        if (this.maskBuffer)
            maskFrame = await this._acquireMaskFrame(frameIndex);
        const { displayWidth, displayHeight } = frame;
        if (maskFrame) {
            this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.offscreenCanvasCtx.drawImage(maskFrame, 0, 0, displayWidth, displayHeight, 0, 0, this.canvas.width, this.canvas.height);
            const maskData = this.offscreenCanvasCtx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            for (let i = 0; i < maskData.data.length; i += 4)
                maskData.data[i + 3] = maskData.data[i];
            this.offscreenCanvasCtx.putImageData(maskData, 0, 0);
            this.canvasCtx.drawImage(this.offscreenCanvas, 0, 0);
            this.canvasCtx.globalCompositeOperation = 'source-in';
            this.canvasCtx.drawImage(frame, 0, 0, displayWidth, displayHeight, 0, 0, this.canvas.width, this.canvas.height);
            this.canvasCtx.globalCompositeOperation = 'source-over';
        }
        else
            this.canvasCtx.drawImage(frame, 0, 0, displayWidth, displayHeight, 0, 0, this.canvas.width, this.canvas.height);
        
        frame.close();
        this.frames[frameIndex] = null;
        if (maskFrame) {
            maskFrame.close();
            this.maskFrames[frameIndex] = null;
        }
        // 更新帧下标
        this.frameIndex = frameIndex;
        // 更新当前时间点
        this.currentTime = time;
        // 如开启循环且当前已播放结束时重置
        if (this.loop && (this.isEnd() || this.currentTime >= this.config.duration)) {
            this.offsetTime += this.currentTime;
            this.reset();
        }
    }

    isEnd() {
        return this.frameIndex >= this.config.frameCount - 1;
    }

    canDestory(time) {
        // 已销毁则避免重复销毁
        if (this.destoryed) return false;
        // 返回当前时间是否大于结束实际
        return time >= this.endTime;
    }

    reset() {
        // 清除未关闭的视频帧避免内存泄露
        this._clearUnclosedFrames();
        this._clearUnclosedMaskFrames();
        this.frameIndex = null;
        this.currentTime = 0;
        this.decodedFrameIndex = 0;
        this.decodedMaskFrameIndex = 0;
        // 重置解码器
        this.decoder && this.decoder.reset();
        // 重置蒙版解码器
        this.maskDecoder && this.maskDecoder.reset();
    }

    /**
     * 销毁资源
     */
    destory() {
        this.decoder && this.decoder.close();
        this.decoder = null;
        this.maskDecoder && this.maskDecoder.close();
        this.maskDecoder = null;
        this._clearUnclosedFrames();
        this._clearUnclosedMaskFrames();
        this.buffer = null;
        this.maskBuffer = null;
        this.frameIndex = null;
        this.currentTime = 0;
        if(this.canvas)
            this.canvas.style.display = "none";
        this.canvas = null;
        this.canvasCtx = null;
        this.offscreenCanvas = null;
        this.offscreenCanvasCtx = null;
        this.destoryed = true;
    }

    /**
     * 拉取视频数据
     */
    async _fetchData() {
        if (!this.buffer) {
            // console.time();
            // 当页面url未定义时采用localhost代替
            const base = window.location.url ? "" : "http://localhost";
            const response = await captureCtx.fetch(base + "/api/video_preprocess", {
                method: "POST",
                body: JSON.stringify(this._exportConfig()),
                retryFetchs: 0
            });
            // console.timeEnd();
            if (!response)
                return null;
            const {
                buffer,
                maskBuffer,
                hasMask
            } = this._unpackData(await response.arrayBuffer());
            this.buffer = buffer;
            if (hasMask)
                this.maskBuffer = maskBuffer;
        }
        return {
            buffer: this.buffer,
            maskBuffer: this.maskBuffer
        }
    }

    /**
     * 清除未关闭的帧
     */
    _clearUnclosedFrames() {
        this.frames
            .forEach((frame, index) => {
                if(!frame)
                    return;
                frame.close();
                this.frames[index] = null;
            });
        this.frames = [];
    }

    /**
     * 清除未关闭的蒙版帧
     */
    _clearUnclosedMaskFrames() {
        this.maskFrames
            .forEach((maskFrame, index) => {
                if(!maskFrame)
                    return;
                maskFrame.close();
                this.maskFrames[index] = null;
            });
        this.maskFrames = [];
    }

    /**
     * 初始化离屏画布
     * 
     * @param {Object} [options] - 画布选项
     * @param {boolean} [options.alpha=true] - 是否支持透明通道
     * @param {boolean} [options.imageSmoothingEnabled=true] - 是否开启抗锯齿
     * @param {boolean} [options.imageSmoothingEnabled="high"] - 抗锯齿强度
     */
    _initOffscreenCanvas(options = {}) {
        const { alpha = true, imageSmoothingEnabled = true, imageSmoothingQuality = "high" } = options;
        // 创建实验性的离屏画布
        this.offscreenCanvas = new OffscreenCanvas(this.canvas.width, this.canvas.height);
        // 获取2D渲染上下文
        this.offscreenCanvasCtx = this.offscreenCanvas.getContext("2d", { alpha, willReadFrequently: false });
        this.canvasCtx.imageSmoothingEnabled = imageSmoothingEnabled;
        this.canvasCtx.imageSmoothingQuality = imageSmoothingQuality;
    }

    /**
     * 获取视频帧
     * 
     * @param {number} frameIndex 帧下标
     * @returns {VideoFrame} - 视频帧
     */
    async _acquireFrame(frameIndex) {
        if (this.frames[frameIndex])
            return this.frames[frameIndex];
        let timer;
        await Promise.race([
            new Promise(resolve => {
                this._clearUnclosedFrames();
                this.waitFrameIndex = frameIndex;
                this.waitFrameCallback = resolve;
            }),
            new Promise((_, reject) => ____setTimeout(() => reject(new Error(`Acquire video frame ${frameIndex} timeout (30s)`)), 30000))
        ]);
        ____clearTimeout(timer);
        return this.frames[frameIndex];
    }

    /**
     * 获取蒙版视频帧
     * 
     * @param {number} frameIndex 帧下标
     * @returns {VideoFrame} - 蒙版视频帧
     */
    async _acquireMaskFrame(frameIndex) {
        if (this.maskFrames[frameIndex])
            return this.maskFrames[frameIndex];
        let timer;
        await Promise.race([
            new Promise(resolve => {
                this._clearUnclosedMaskFrames();
                this.waitMaskFrameIndex = frameIndex;
                this.waitMaskFrameCallback = resolve;
            }),
            new Promise((_, reject) => ____setTimeout(() => reject(new Error(`Acquire mask video frame ${frameIndex} timeout (30s)`)), 30000))
        ]);
        ____clearTimeout(timer);
        return this.maskFrames[frameIndex];
    }

    /**
     * 通知新视频帧产生
     * 
     * @param {VideoFrame} frame - 视频帧
     */
    _emitNewFrame(frame) {
        frame.index = this.decodedFrameIndex;
        this.frames[frame.index] = frame;
        if (this.waitFrameCallback && this.waitFrameIndex == frame.index) {
            const fn = this.waitFrameCallback;
            this.waitFrameIndex = null;
            this.waitFrameCallback = null;
            fn();
        }
        else if(frame.index < this.waitFrameIndex)
            frame.close();
        this.decodedFrameIndex++;
    }

    /**
     * 通知新蒙版视频帧产生
     * 
     * @param {VideoFrame} frame - 视频帧
     */
    _emitNewMaskFrame(frame) {
        frame.index = this.decodedMaskFrameIndex;
        this.maskFrames[frame.index] = frame;
        if (this.waitMaskFrameCallback && this.waitMaskFrameIndex == frame.index) {
            const fn = this.waitMaskFrameCallback;
            this.waitMaskFrameIndex = null;
            this.waitMaskFrameCallback = null;
            fn();
        }
        else if(frame.index < this.waitMaskFrameIndex)
            frame.close();
        this.decodedMaskFrameIndex++;
    }

    /**
     * 创建解码器
     * 
     * @param {Uint8Array} data - 视频数据
     * @param {Object} options - 解码器选项
     * @param {boolean} options.isMask - 是否为蒙版
     * @param {Function} options.onFrame - 视频帧回调
     * @param {Function} options.onError - 错误回调
     * @returns {Object} - 解码器和配置对象
     */
    async _createDecoder(data, options = {}) {
        const u = ____util$2;
        const { isMask = false, onFrame, onError } = options;
        u.assert(u.isUint8Array(data), "data must be Uint8Array");
        u.assert(u.isBoolean(isMask), "isMask must be boolean");
        u.assert(u.isFunction(onFrame), "onFrame must be Function");
        u.assert(u.isFunction(onError), "onError must be Function");
        const decoder = (isMask ? this.maskDecoder : this.decoder) || new VideoDecoder({
            output: onFrame.bind(this),
            error: err => onError.bind(this)(new Error(err))
        });
        const demuxer = new MP4Demuxer();
        let timer;
        const waitConfigPromise = Promise.race([
            new Promise((resolve, reject) => {
                demuxer.onConfig(config => {
                    decoder.configure({
                        // 视频信息配置
                        ...config,
                        // 解码器硬件加速指示
                        hardwareAcceleration: this.hardwareAcceleration,
                        // 关闭延迟优化，让解码器批量处理解码，降低负载
                        optimizeForLatency: true
                    });
                    resolve(config);
                });
                demuxer.onError(reject);
            }),
            new Promise((_, reject) => timer = ____setTimeout(() => reject(new Error(`Video buffer demux timeout (60s)`)), 60000))
        ]);
        ____clearTimeout(timer);
        demuxer.onChunk(chunk => decoder.decode(chunk));
        demuxer.load(data);
        // 等待解码配置
        const config = await waitConfigPromise;
        // 画布宽度为0时使用解码宽度初始化
        if(this.canvas.width === 0)
            this.canvas.width = config.codedWidth;
        // 画布高度为0时使用解码高度初始化
        if(this.canvas.height === 0)
            this.canvas.height = config.codedHeight;
        // 检查视频解码器是否支持当前配置
        await VideoDecoder.isConfigSupported(config);
        if(decoder.state == "configured") {
            decoder.flush()
                .catch(err => err.message.indexOf("Aborted due to close") === -1 && err.message.indexOf("closed codec") === -1 ? console.error(err) : 0);
        }
        return {
            config,
            decoder
        };
    }

    /**
     * 导出视频配置
     * 
     * @returns {VideoConfig} - 视频配置
     */
    _exportConfig() {
        return {
            url: this.url,
            maskUrl: this.maskUrl,
            format: this.format,
            startTime: this.startTime,
            endTime: this.endTime,
            audioId: this.audioId,
            seekStart: this.seekStart,
            seekEnd: this.seekEnd,
            fadeInDuration: this.fadeInDuration,
            fadeOutDuration: this.fadeOutDuration,
            autoplay: this.autoplay,
            volume: this.volume,
            loop: this.loop,
            muted: this.muted,
            retryFetchs: this.retryFetchs,
            ignoreCache: this.ignoreCache
        };
    }

    /**
     * 解包数据
     * 从封装的ArrayBuffer中提取原始数据对象
     * 
     * @param {ArrayBuffer} packedData - 已封装数据
     * @returns {Object} - 原始数据对象
     */
    _unpackData(packedData) {
        const dataView = new DataView(packedData);
        let delimiterIndex = -1;
        for (let i = 0; i < dataView.byteLength; i++) {
            if (dataView.getUint8(i) === '!'.charCodeAt(0)) {
                delimiterIndex = i;
                break;
            }
        }
        if (delimiterIndex === -1)
            throw new Error("Invalid data format: header delimiter not found");
        const lengthBytes = new Uint8Array(dataView.buffer, 0, delimiterIndex);
        const objLength = parseInt(String.fromCharCode(...lengthBytes));
        if (isNaN(objLength) || objLength <= 0 || objLength > dataView.byteLength - delimiterIndex - 1)
            throw new Error("Invalid data format: Invalid data length");
        const objBytes = new Uint8Array(dataView.buffer, delimiterIndex + 1, objLength);
        const obj = JSON.parse(new TextDecoder("utf-8").decode(objBytes));
        const bufferOffset = delimiterIndex + 1 + objLength;
        for (const key in obj) {
            if (Array.isArray(obj[key]) && obj[key][0] === "buffer") {
                const [_, start, end] = obj[key];
                obj[key] = new Uint8Array(dataView.buffer.slice(bufferOffset + start, bufferOffset + end));
            }
        }
        return obj;
    }

}

const ____util$1 = innerUtil();

/**
 * 动态图像
 */
class DynamicImage {

    /** @type {string} - 图像来源 */
    url;
    /** @type {string} - 图像格式（gif/webp/apng） */
    format;
    /** @type {number} - 开始播放时间点（毫秒） */
    startTime;
    /** @type {number} - 结束播放时间（毫秒） */
    endTime;
    /** @type {boolean} - 是否强制循环 */
    loop;
    /** @type {number} - 重试下载次数 */
    retryFetchs;
    /** @type {number} - 帧索引 */
    frameIndex = 0;
    /** @type {number} - 重复索引 */
    repetitionIndex = 0;
    /** @type {number} - 当前播放时间点（毫秒） */
    currentTime = 0;
    /** @type {HTMLCanvasElement} - 画布元素 */
    canvas = null;
    /** @type {CanvasRenderingContext2D}  - 画布2D渲染上下文*/
    canvasCtx = null;
    /** @type {number} - 上一帧时间戳（毫秒） */
    lastFrameTimestamp = null;
    /** @type {number} - 上一帧时长（毫秒） */
    lastFrameDuration = null;
    /** @type {Function} - 错误回调函数 */
    errorCallback;
    /** @type {ImageDecoder} - 图像解码器 */
    decoder = null;
    /** @type {boolean} - 是否被移除 */
    removed = false;
    /** @type {boolean} - 是否已销毁 */
    destoryed = false;

    /**
     * 构造函数
     * 
     * @param {Object} options - 动态图像选项
     * @param {string} options.url - 图像来源
     * @param {number} options.startTime - 开始播放时间点（毫秒）
     * @param {number} options.endTime - 结束播放时间点（毫秒）
     * @param {string} [options.format] - 图像格式
     * @param {boolean} [options.loop] - 是否强制循环
     * @param {number} [options.retryFetchs=2] - 重试下载次数
     */
    constructor(options) {
        const u = ____util$1;
        u.assert(u.isObject(options), "DynamicImage options must be Object");
        const { url, format, startTime, endTime, loop, retryFetchs } = options;
        u.assert(u.isString(url), "url must be string");
        u.assert(u.isNumber(startTime), "startTime must be number");
        u.assert(u.isNumber(endTime), "endTime must be number");
        u.assert(u.isUndefined(format) || u.isString(format), "format must be string");
        u.assert(u.isUndefined(loop) || u.isBoolean(loop), "loop must be boolean");
        u.assert(u.isUndefined(retryFetchs) || u.isNumber(retryFetchs), "retryFetchs must be number");
        this.url = url;
        this.startTime = startTime;
        this.endTime = endTime;
        this.format = format;
        this.loop = loop;
        this.retryFetchs = u.defaultTo(retryFetchs, 2);
    }

    /**
     * 绑定画布元素
     * 
     * @param {HTMLCanvasElement} canvas - 画布元素
     * @param {Object} [options] - 画布选项
     * @param {boolean} [options.alpha=true] - 是否支持透明通道
     * @param {boolean} [options.imageSmoothingEnabled=true] - 是否开启抗锯齿
     */
    bind(canvas, options = {}) {
        const { alpha = true, imageSmoothingEnabled = true } = options;
        this.canvas = canvas;
        this.canvas.____onRemoved = () => this.removed = true;
        // 获取画布2D上下文
        this.canvasCtx = this.canvas.getContext("2d", { alpha });
        // 设置抗锯齿开关
        this.canvasCtx.imageSmoothingEnabled = imageSmoothingEnabled;
    }

    /**
     * 判断当前时间点是否可播放
     * 
     * @param {number} time - 时间点
     * @returns {boolean} - 是否可播放
     */
    canPlay(time) {
        // 已销毁不可播放
        if (this.destoryed) return false;
        // 如果当前时间超过元素开始结束时间则判定未不可播放
        const { startTime, endTime } = this;
        if (time < startTime || time >= endTime)
            return false;
        return true;
    }

    /**
     * 加载图像
     */
    async load() {
        try {
            // 下载图像数据
            const response = await captureCtx.fetch(this.url, this.retryFetchs);
            // 如果获得null可能响应存在问题，直接销毁对象，具体错误报告由Page.js的响应拦截器处理
            if (!response) {
                this.destory();
                return false;
            }
            // 获取MIME类型
            let contentType = response.headers.get("Content-Type") || response.headers.get("content-type");
            if (!contentType)
                throw new Error(`image Content-Type unknown is not supported`);
            contentType = contentType.split(";")[0];
            // 检查图像解码器是否是否支持此图像类型
            if (!await ImageDecoder.isTypeSupported(contentType))
                throw new Error(`image type ${contentType} is not supported`);
            // 实例化图像解码器
            this.decoder = new ImageDecoder({
                // MIME类型
                type: contentType,
                // 图像数据
                data: response.body
            });
            // 等待数据完成加载
            await this.decoder.completed;
            return true;
        }
        catch (err) {
            console.error(err);
            this.destory();
            return false;
        }
    }

    /**
     * 是否准备完毕
     * 
     * @returns {boolean} - 是否准备完毕
     */
    isReady() {
        return !!this.decoder;
    }

    /**
     * 索引帧并绘制
     * 
     * @param {number} time - 索引时间点
     */
    async seek(time) {
        // 已销毁不可索引
        if (this.destoryed) return;
        // 如果元素已移除或当前图像不循环且播放结束则不再索引
        if (this.removed || (!this.loop && this.isEnd())) return;
        // 获取图像轨道
        const track = this.getSelectedTrack();
        // 无可用图像轨道将跳过处理
        if (!track) return;
        // 当解码完成且帧索引指向最后一帧时重置帧指针
        if (this.decoder.complete && this.frameIndex >= track.frameCount + 1)
            this.reset();
        // 当存在上一帧且上一帧未完成停留时长前将跳过绘制下一帧，节约重绘频次
        if (time !== 0 && this.lastFrameDuration && time < (this.lastFrameTimestamp + this.lastFrameDuration)) {
            this.currentTime = time;
            return;
        }
        // 等待帧解码
        const result = await new Promise((resolve, reject) => {
            // 解码该帧图像
            this.decoder.decode({ frameIndex: this.frameIndex++ })
                .then(resolve)
                .catch(err => {
                    // 为效率考虑解码和绘制是同时进行的，如绘制快于解码时可能出现超出帧范围需容错处理
                    if (err instanceof RangeError) {
                        // 重置帧索引
                        this.reset();
                        // 等待30毫秒后再触发resolve，避免后续疯狂递归
                        ____setTimeout(resolve, 30);
                    }
                    // 其它错误抛出
                    else
                        reject(err);
                });
        });
        // 如果因重置未解码任何帧将重新seek
        if (!result) return this.seek(time);
        // 如未解码出任何图像帧将跳过该时间点
        if (!result.image) return;
        const frame = result.image;
        const { displayWidth, displayHeight } = frame;
        // 画布宽度为0时使用解码宽度初始化
        if(this.canvas.width === 0)
            this.canvas.width = config.codedWidth;
        // 画布高度为0时使用解码高度初始化
        if(this.canvas.height === 0)
            this.canvas.height = config.codedHeight;
        // 清除上一帧画面
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // 绘制当前帧
        this.canvasCtx.drawImage(frame, 0, 0, displayWidth, displayHeight, 0, 0, this.canvas.width, this.canvas.height);
        // 记录当前帧时长
        this.lastFrameDuration = frame.duration / 1000;
        // 记录当前帧时间戳
        this.lastFrameTimestamp = time;
        // 更新当前时间点
        this.currentTime = time;
    }

    /**
     * 判断动画是否已结束
     * 
     * @returns {boolean} - 是否已结束
     */
    isEnd() {
        // 获取图像轨道
        const track = this.getSelectedTrack();
        // 无可用图像轨道将返回已结束
        if (!track) return true;
        // 如果强制不循环将只播放一次
        if (this.loop === false)
            return this.repetitionIndex >= 1;
        // 其它情况遵循文件自身重复次数
        return this.repetitionIndex >= track.repetitionCount + 1;
    }

    /**
     * 判断是否可销毁
     * 
     * @returns {boolean} - 是否可销毁
     */
    canDestory(time) {
        // 已销毁则避免重复销毁
        if (this.destoryed) return false;
        // 返回当前时间是否大于结束时间
        return time >= this.endTime;
    }

    /**
     * 重置图像状态
     */
    reset() {
        // 播放进度重置
        this.currentTime = 0;
        // 帧索引重置
        this.frameIndex = 0;
        // 上一帧时间戳重置
        this.lastFrameTimestamp = null;
        // 上一帧时长重置
        this.lastFrameDuration = null;
        // 重复次数自增1
        this.repetitionIndex++;
    }

    /**
     * 注册错误回调函数
     * 
     * @param {Function} callback - 回调函数
     */
    onError(callback) {
        this.errorCallback = callback;
    }

    /**
     * 获取已选取轨道
     */
    getSelectedTrack() {
        return this.decoder.tracks.selectedTrack;
    }

    /**
     * 销毁动态图像实例
     */
    destory() {
        // 如果解码器存在则先关闭解码器
        this.decoder && this.decoder.close();
        this.decoder = null;
        // 重置图像
        this.reset();
        this.repetitionIndex = 0;
        if(this.canvas)
            this.canvas.style.display = "none";
        this.canvas = null;
        this.canvasCtx = null;
        // 设置已销毁
        this.destoryed = true;
    }

}

const ____util = innerUtil();

/**
 * Lottie画布
 */
class LottieCanvas {

    /** @type {string} - lottie来源 */
    url;
    /** @type {number} - 开始播放时间 */
    startTime;
    /** @type {number} - 结束播放时间 */
    endTime;
    /** @type {boolean} - 是否强制循环 */
    loop;
    /** @type {number} - 重试下载次数 */
    retryFetchs;
    /** @type {number} - 帧索引 */
    frameIndex = 0;
    /** @type {number} - 当前播放时间点 */
    currentTime = 0;
    /** @type {HTMLCanvasElement} - 画布元素s */
    canvas = null;
    /** @type {CanvasRenderingContext2D} - 画布2D渲染s上下文 */
    canvasCtx = null;
    /** @type {Object} - Lottie动画对象 */
    animation = null;
    /** @type {boolean} - 是否已销毁 */
    destoryed = false;

    /**
     * 构造函数
     * 
     * @param {Object} options - Lottie动画选项
     * @param {string} options.url - 图像来源
     * @param {number} options.startTime - 开始播放时间点（毫秒）
     * @param {number} options.endTime - 结束播放时间点（毫秒）
     * @param {boolean} [options.loop] - 是否强制循环
     * @param {number} [options.retryFetchs=2] - 重试下载次数
     */
    constructor(options) {
        const u = ____util;
        u.assert(u.isObject(options), "LottieCanvas options must be Object");
        const { url, startTime, endTime, loop, retryFetchs } = options;
        u.assert(u.isString(url), "url must be string");
        u.assert(u.isNumber(startTime), "startTime must be number");
        u.assert(u.isNumber(endTime), "endTime must be number");
        u.assert(u.isUndefined(loop) || u.isBoolean(loop), "loop must be boolean");
        u.assert(u.isUndefined(retryFetchs) || u.isNumber(retryFetchs), "retryFetchs must be number");
        this.url = url;
        this.startTime = startTime;
        this.endTime = endTime;
        this.loop = loop;
        this.retryFetchs = u.defaultTo(retryFetchs, 2);
    }

    /**
     * 绑定画布元素
     * 
     * @param {HTMLCanvasElement} canvas - 画布元素
     * @param {Object} [options] - 画布选项
     * @param {boolean} [options.alpha=true] - 是否支持透明通道
     * @param {boolean} [options.imageSmoothingEnabled=true] - 是否开启抗锯齿
     */
    bind(canvas, options = {}) {
        const { alpha = true, imageSmoothingEnabled = true } = options;
        this.canvas = canvas;
        // 获取画布2D上下文
        this.canvasCtx = this.canvas.getContext("2d", { alpha });
        // 设置抗锯齿开关
        this.canvasCtx.imageSmoothingEnabled = imageSmoothingEnabled;
    }

    /**
     * 判断当前时间点是否可播放
     * 
     * @param {number} time - 时间点
     * @returns {boolean} - 是否可播放
     */
    canPlay(time) {
        // 已销毁不可播放
        if (this.destoryed) return false;
        // 如果当前时间超过元素开始结束时间则判定未不可播放
        const { startTime, endTime } = this;
        if (time < startTime || time >= endTime)
            return false;
        return true;
    }

    /**
     * 加载Lottie
     */
    async load() {
        try {
            // 下载Lottie数据
            const response = await captureCtx.fetch(this.url, this.retryFetchs);
            // 如果获得null可能响应存在问题，直接销毁对象，具体错误报告由Page.js的响应拦截器处理
            if (!response) {
                this.destory();
                return false;
            }
            // 获取MIME类型
            let contentType = response.headers.get("Content-Type") || response.headers.get("content-type");
            if (!contentType)
                throw new Error(`lottie Content-Type unknown is not supported`);
            contentType = contentType.split(";")[0];
            // 检查是否为Lottie的json格式
            if (contentType !== "application/json")
                throw new Error(`lottie Content-Type ${contentType} is not supported`);
            // 转换为json对象
            const animationData = await response.json();
            // 调用Lottie动画库加载动画 - 动画库由Page.js注入
            this.animation = ____lottie.loadAnimation({
                // 是否循环播放动画
                loop: this.loop,
                // 动画JSON数据
                animationData,
                // 使用canvas模式渲染
                renderer: "canvas",
                // 启用自动播放
                autoplay: true,
                // 渲染器设置画布上下文
                rendererSettings: {
                    context: this.canvasCtx
                }
            });
            return true;
        }
        catch (err) {
            console.error(err);
            this.destory();
            return false;
        }
    }

    /**
     * 是否准备完毕
     * 
     * @returns {boolean} - 是否准备完毕
     */
    isReady() {
        return !!this.animation;
    }

    /**
     * 索引帧并绘制
     * 
     * @param {number} time - 索引时间点
     */
    async seek(time) {
        if (this.destoryed) return;
        this.currentTime = time;
        this.frameIndex++;
    }

    /**
     * 判断是否可销毁
     * 
     * @returns {Boolean}
     */
    canDestory(time) {
        // 已销毁则避免重复销毁
        if (this.destoryed) return false;
        // 返回当前时间是否大于结束实际
        return time >= this.endTime;
    }

    /**
     * 重置Lottie动画
     */
    reset() {
        this.frameIndex = 0;
        this.currentTime = 0;
    }

    /**
     * 销毁Lottie实例
     */
    destory() {
        // 销毁动画对象
        this.animation && this.animation.destroy();
        this.animation = null;
        // 重置动画
        this.reset();
        if(this.canvas)
            this.canvas.style.display = "none";
        this.canvas = null;
        this.canvasCtx = null;
        // 设置已销毁
        this.destoryed = true;
    }

}

class CaptureContext {

    /** 媒体选择器 */
    SVG_SELECTOR = "svg";
    AUDIO_SELECTOR = 'audio[src$=".mp3"],audio[src$=".ogg"],audio[src$=".acc"],audio[src*=".mp3?"],audio[src*=".ogg?"],audio[src*=".aac?"],audio[capture]';
    VIDEO_SELECTOR = 'video[src$=".mp4"],video[src$=".webm"],video[src$=".mkv"],video[src*=".mp4?"],video[src*=".webm?"],video[src*=".mkv?"],video[capture],canvas[video-capture]';
    DYNAMIC_IMAGE_SELECTOR = 'img[src$=".gif"],img[src$=".webp"],img[src$=".apng"],img[src*=".gif?"],img[src*=".webp?"],img[src*=".apng?"],img[capture],canvas[dyimage-capture]';
    LOTTIE_SELECTOR = "lottie,canvas[lottie-capture]";

    /** @type {number} - 启动时间点（毫秒） */
    startTime = Date.now();
    /** @type {number} - 当前时间点（毫秒） */
    currentTime = 0;
    /** @type {number} - 当前帧指针 */
    frameIndex = 0;
    /** @type {number} - 帧间隔时间（毫秒） */
    frameInterval = 0;
    /** @type {boolean} - 准备完毕标志 */
    readyFlag = false;
    /** @type {boolean} - 启动标志 */
    startFlag = false;
    /** @type {boolean} - 停止标志 */
    stopFlag = false;
    /** @type {boolean} - 暂停标志 */
    pauseFlag = false;
    /** @type {number} - 准备完毕时间点 */
    readyTime;
    /** @type {Function} - 准备完毕回调 */
    readyCallback;
    /** @type {Function} - 恢复回调 */
    resumeCallback = null;
    /** @type {Function[]} - 间隔回调列表 */
    intervalCallbacks = [];
    /** @type {Function[]} - 超时回调列表 */
    timeoutCallbacks = [];
    /** @type {number} - 计时器自增ID */
    timerId = 0;
    /** @type {number} - 自增音频ID */
    audioId = 0;
    /** @type {number} - 应用于Date对象的时间偏移HACK（处理mojs动画） */
    timeOffset = 0;
    /** @type {Object} - 配置对象 */
    config = {
        /** @type {number} - 渲染帧率 */
        fps: null,
        /** @type {number} - 开始时间点 */
        startTime: 0,
        /** @type {number} - 总时长 */
        duration: null,
        /** @type {number} - 目标总帧数 */
        frameCount: null
    };
    /** @type {SvgAnimation[]|VideoCanvas[]|DynamicImage[]|LottieCanvas[]} - 媒体调度列表 */
    dispatchMedias = [];

    /**
     * 构造函数
     */
    constructor() {
        // 控制台输出重写
        this._consoleRewrite();
        // 元素行为重写
        this._elementRewrite();
        // 时间虚拟化重写
        this._timeVirtualizationRewrite();
    }

    /**
     * 初始化上下文
     */
    init() {
        // 自动触发超时和间隔回调
        this._callTimeoutCallbacks();
        this._callIntervalCallbacks();
    }

    /**
     * 准备完毕
     * 
     * @return {boolean} - 是否已启动
     */
    ready() {
        // 设置准备完毕标志为true
        this.readyFlag = true;
        // 设置准备完毕时的时间点
        this.readyTime = performance.____now();
        // 如果存在准备前的启动则调用
        if (this.readyCallback) {
            this.readyCallback();
            return true;
        }
        return false;
    }

    /**
     * 是否已经启动捕获
     */
    isCapturing() {
        return this.currentTime >= (this.config.startTime || 0);
    }

    /**
     * 开始捕获
     */
    start() {
        // 如果在准备完毕前启动则延迟到准备完毕再启动
        if (!this.readyFlag) {
            this.readyCallback = this.start;
            return;
        }
        // 检查配置
        this._checkConfig();
        // 插入捕获辅助元素
        this._insertCaptureHelper();
        // 转换元素为媒体元素
        this._convertElementsToMedias();
        // 监听媒体插入
        this._observMediaInsert();
        // 更新开始时间
        this.startTime = Date.now();
        // 计算帧间隔时间
        this.frameInterval = 1000 / this.config.fps;

        // 递归捕获帧
        (function nextFrame() {
            (async () => {
                // 设置启动标志位
                if (!this.startFlag)
                    this.startFlag = true;
                // 如果已停止则跳出
                if (this.stopFlag)
                    return ____screencastCompleted();

                // 媒体调度
                const mediaRenderPromises = this.dispatchMedias.map(media => (async () => {
                    // 媒体可销毁时执行销毁
                    if (media.canDestory(this.currentTime))
                        return media.destory();
                    // 如媒体不可播放则跳过调度
                    if (!media.canPlay(this.currentTime))
                        return;
                    // 媒体未准备完毕时调用加载
                    if (!media.isReady()) {
                        // 加载媒体，如加载失败则跳过
                        if (!await media.load())
                            return;
                    }                    const mediaCurrentTime = this.currentTime - media.startTime - (media.offsetTime || 0);
                    await media.seek(mediaCurrentTime > 0 ? mediaCurrentTime : 0);
                })());
                await Promise.all(mediaRenderPromises);

                // CSS动画调度                
                await ____seekCSSAnimations(this.currentTime);
                // 动作序列调度
                await ____seekTimeActions(this.currentTime);

                // 根据帧间隔推进当前时间
                this.currentTime += this.frameInterval;
                // 时间偏移HACK重置（处理mojs动画）
                this.timeOffset = 0;
                // 触发轮询回调列表
                this._callIntervalCallbacks(this.currentTime);
                // 触发超时回调列表
                this._callTimeoutCallbacks(this.currentTime);

                // 是否处于捕获中状态
                if (this.isCapturing()) {

                    // 捕获帧图 - 此函数请见Page.js的#envInit的exposeFunction
                    if (!await ____captureFrame()) {
                        this.stopFlag = true;
                        return;
                    }

                    // 遇到暂停标志时等待恢复
                    if (this.pauseFlag)
                        await new Promise(resolve => this.resumeCallback = resolve);
                    // 捕获帧数到达目标帧数时终止捕获
                    if (++this.frameIndex >= this.config.frameCount) {
                        this.stopFlag = true;
                        // 完成录制回调 - 此函数请见Page.js的#envInit的exposeFunction
                        return ____screencastCompleted();
                    }
                    // 如果未到达目标帧数但已被停止也触发录制完成
                    else if (this.stopFlag)
                        return ____screencastCompleted();

                }
                // 跳过无需捕获的帧
                else
                    await ____skipFrame();

                // 开始捕获下一帧
                nextFrame.bind(this)();
            })()
                .catch(err => console.error(err));
        }).bind(this)();
    }

    /**
     * 终止捕获
     */
    abort() {
        if(!this.isCapturing())
            return;
        this.stopFlag = true;
    }

    /**
     * 检查配置
     */
    _checkConfig() {
        const { fps, duration, frameCount } = this.config;
        if (isNaN(fps) || fps <= 0)
            throw new Error(`config fps ${fps} is invalid`);
        if (isNaN(duration) || duration <= 0)
            throw new Error(`config duration ${duration} is invalid`);
        if (isNaN(frameCount) || frameCount <= 0)
            throw new Error(`config frameCount ${frameCount} is invalid`);
    }

    /**
     * 插入捕获辅助元素
     * BeginFrame可能会陷入假死，这个元素会不断旋转确保总是产生新的帧
     */
    _insertCaptureHelper() {
        const captureHelper = document.createElement("capture-helper");
        // 设置几乎看不见的样式
        Object.assign(captureHelper.style, {
            width: "0.1px",
            height: "0.1px",
            opacity: 0.1,
            position: "fixed",
            top: 0,
            left: 0,
            zIndex: 999,
            backgroundColor: "#fff",
            transform: "rotate(0deg)"
        });
        // 加入到body中
        (document.body || document).appendChild(captureHelper);
        let rotate = 0;
        (function update() {
            rotate = rotate >= 360 ? 0 : (rotate + 0.1);
            captureHelper.style.transform = `rotate(${rotate}deg)`;
            // 如果已启动则高频更新，未启动时摸鱼
            if (this.startFlag)
                ____setTimeout(update.bind(this), 0);
            else
                ____setTimeout(update.bind(this), 1000);
        }).bind(this)();
    }

    /**
     * 转换元素为媒体对象
     * 
     * @private
     */
    _convertElementsToMedias() {
        const svgs = document.querySelectorAll(this.SVG_SELECTOR);
        const audios = document.querySelectorAll(this.AUDIO_SELECTOR);
        const videos = document.querySelectorAll(this.VIDEO_SELECTOR);
        const dynamicImages = document.querySelectorAll(this.DYNAMIC_IMAGE_SELECTOR);
        const lotties = document.querySelectorAll(this.LOTTIE_SELECTOR);
        svgs.forEach(e => captureCtx.convertToSvgAnimation(e));
        audios.forEach(e => captureCtx.convertToInnerAudio(e));
        videos.forEach(e => captureCtx.convertToVideoCanvas(e));
        dynamicImages.forEach(e => captureCtx.convertToDynamicImage(e));
        lotties.forEach(e => captureCtx.convertToLottieCanvas(e));
    }

    /**
     * 监听媒体插入
     * 
     * @private
     */
    _observMediaInsert() {
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === "childList") {
                    if (mutation.addedNodes.length > 0) {
                        for (const addedNode of mutation.addedNodes) {
                            if (!addedNode.matches)
                                return;
                            if (addedNode.matches("canvas"))
                                break;
                            else if (addedNode.matches(this.SVG_SELECTOR))
                                this.convertToSvgAnimation(addedNode);
                            else if (addedNode.matches(this.DYNAMIC_IMAGE_SELECTOR))
                                this.convertToDynamicImage(addedNode);
                            else if (addedNode.matches(this.AUDIO_SELECTOR))
                                this.convertToInnerAudio(addedNode);
                            else if (addedNode.matches(this.VIDEO_SELECTOR))
                                this.convertToVideoCanvas(addedNode);
                            else if (addedNode.matches(this.LOTTIE_SELECTOR))
                                this.convertToLottieCanvas(addedNode);
                        }
                    }
                    if (mutation.removedNodes.length > 0) {
                        for (const removedNode of mutation.removedNodes) {
                            // 通知节点移除
                            removedNode.____onRemoved && removedNode.____onRemoved();
                        }
                    }
                }
            }
        });
        observer.observe(document.body || document, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });
    }

    /**
     * 控制台输出重写
     */
    _consoleRewrite() {
        const getPrintFun = fn => ((...args) =>
            fn.bind(console)(args.reduce((t, v) => {
                if (v instanceof Error)
                    return `${t}\n${v.stack} `;
                else if (v instanceof Object)
                    return `${t}${JSON.stringify(v)} `;
                return `${t}${v} `;
            }, "")));
        console.____log = console.log;
        console.log = getPrintFun(console.____log);
        console.____warn = console.warn;
        console.warn = getPrintFun(console.____warn);
        console.____error = console.error;
        console.error = getPrintFun(console.____error);
        console.____debug = console.debug;
        console.debug = getPrintFun(console.____debug);
    }

    /**
     * 元素行为重写
     */
    _elementRewrite() {
        // 支持获取html元素布尔属性
        HTMLElement.prototype.getBooleanAttribute = function (name) {
            const value = this.getAttribute(name);
            if (value == null) return undefined;
            return value == "false" ? false : true;
        };
        // 支持获取html元素数字属性
        HTMLElement.prototype.getNumberAttribute = function (name) {
            const value = this.getAttribute(name);
            if (value == null) return undefined;
            return Number(value);
        };
        // 支持获取svg元素数字属性
        SVGSVGElement.prototype.getNumberAttribute = function (name) {
            const value = this.getAttribute(name);
            if (value == null) return undefined;
            return Number(value);
        };
    }

    /**
     * 时间虚拟化重写
     * 
     * @private
     */
    _timeVirtualizationRewrite() {
        // 暂存setInterval函数
        window.____setInterval = window.setInterval;
        // 重写setInterval函数
        window.setInterval = (fn, interval) => {
            if (typeof fn !== "function" || isNaN(interval))
                return;
            this.timerId--;
            this.intervalCallbacks.push([this.timerId, this.currentTime, interval, fn]);
            return this.timerId;
        };
        // 暂存clearInterval函数
        window.____clearInterval = window.clearInterval;
        // 重写cleanInterval函数
        window.clearInterval = timerId => {
            if (!timerId) return;
            if (timerId >= 0)
                return window.____clearInterval(timerId);
            this.intervalCallbacks = this.intervalCallbacks.filter(([_timerId]) => {
                if (_timerId == timerId)
                    return false;
                return true;
            });
        };
        // 暂存setTimeout函数
        window.____setTimeout = window.setTimeout;
        // 重写setTimeout函数
        window.setTimeout = (fn, timeout = 0) => {
            if (typeof fn !== "function" || isNaN(timeout))
                return;
            this.timerId--;
            this.timeoutCallbacks.push([this.timerId, this.currentTime, timeout, fn]);
            return this.timerId;
        };
        // 暂存clearTimeout函数
        window.____clearTimeout = window.clearTimeout;
        // 重写clearTimeout函数
        window.clearTimeout = timerId => {
            if (!timerId) return;
            if (timerId >= 0)
                return window.____clearTimeout(timerId);
            this.timeoutCallbacks = this.timeoutCallbacks.filter(([_timerId]) => {
                if (_timerId == timerId)
                    return false;
                return true;
            });
        };
        // 暂存requestAnimationFrame函数
        window.____requestAnimationFrame = window.requestAnimationFrame;
        // 重写requestAnimationFrame，传递上下文提供的currentTime确保在非60fps捕获时实现帧率同步
        window.requestAnimationFrame = fn => {
            if (!this.startFlag)
                return setTimeout(currentTime => fn(currentTime), 0);
            if (this.stopFlag)
                return;
            // 下一个事件循环再调用
            return window.____requestAnimationFrame(() => fn(this.currentTime));
        };
        // 暂存Date对象
        window.____Date = Date;
        const ctx = this;
        // 重写Date构造函数
        window.Date = function Date(...args) {
            if (new.target === undefined)
                return new window.____Date(ctx.startTime + ctx.currentTime).toString();
            if (args.length === 0)
                return new window.____Date(ctx.startTime + ctx.currentTime);
            return new window.____Date(...args);
        };
        // 将挂载的函数
        Object.assign(window.Date, {
            prototype: window.____Date.prototype,
            now: () => Math.floor(this.startTime + this.currentTime) + (this.timeOffset += 0.01),
            parse: window.____Date.parse.bind(window.____Date),
            UTC: window.____Date.UTC.bind(window.____Date)
        });
        // 重写performance.now函数
        performance.____now = performance.now;
        performance.now = () => this.currentTime;
        // 启动前进行定时器调度，避免死锁
        (async () => {
            (function dispatchBeforeStart() {
                // 如果已启动则不再调度，调度权交由nextFrame调度
                if (this.startFlag)
                    return;
                // 如果已准备完毕开始调度操作
                if(this.readyFlag) {
                    const currentTime = performance.____now() - this.readyTime;
                    this._callTimeoutCallbacks(currentTime);
                    this._callIntervalCallbacks(currentTime);
                    ____setTimeout(dispatchBeforeStart.bind(this), 0);
                }
                // 如果还未准备完毕则进行轮询检查
                else
                    ____setTimeout(dispatchBeforeStart.bind(this), 1000);
            }).bind(this)();
        })();
    }

    /**
     * 拼接完整URL
     * 
     * @private
     * @param {string} relativeUrl - 相对URL
     * @returns {string} - 绝对URL
     */
    _currentUrlJoin(relativeUrl) {
        if (!relativeUrl || /^(https?:)?\/\//.test(relativeUrl))
            return relativeUrl;
        const currentURL = window.location.href;
        return new URL(relativeUrl, currentURL).href;
    }

    /**
     * 触发轮询函数回调
     * 
     * @private
     */
    _callIntervalCallbacks(currentTime) {
        if (this.intervalCallbacks.length == 0)
            return;
        for (let i = 0; i < this.intervalCallbacks.length; i++) {
            const [timerId, timestamp, interval, fn] = this.intervalCallbacks[i];
            if (currentTime < timestamp + interval)
                continue;
            this.intervalCallbacks[i][1] = currentTime;
            // 下一个事件循环再调用
            ____setTimeout(() => fn(currentTime), 0);
        }
    }

    /**
     * 触发超时函数回调
     * 
     * @private
     */
    _callTimeoutCallbacks(currentTime) {
        if (this.timeoutCallbacks.length == 0)
            return;
        this.timeoutCallbacks = this.timeoutCallbacks.filter(([timerId, timestamp, timeout, fn]) => {
            if (currentTime < timestamp + timeout)
                return true;
            // 下一个事件循环再调用
            ____setTimeout(() => fn(currentTime), 0);
            return false;
        });
    }

    /**
     * 创建画布
     * 
     * @private
     */
    _createCanvas(options) {
        const { id, class: _class, width, height } = options;
        const canvas = document.createElement("canvas");
        id && canvas.setAttribute("id", id);
        _class && canvas.setAttribute("class", _class);
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    /**
     * 添加音频
     */
    addAudio(options = {}) {
        const audioId = this.audioId++;
        const { url } = options;
        url && (options.url = this._currentUrlJoin(url));
        ____addAudio({
            audioId,
            ...options
        });
    }

    /**
     * 添加多个音频
     */
    addAudios(audios = []) {
        audios.forEach(audio => this.addAudio(audio));
    }

    /**
     * 转化为SVG动画对象
     * 
     * @param {SVGSVGElement} e - SVG元素
     */
    convertToSvgAnimation(e) {
        const hasAnimation = e.querySelector("animate, animateTransform, animateMotion, animateColor");
        // 未找到任何动画元素则不做处理，这些SVG元素可能是静态的或者由其它动画库控制
        if (!hasAnimation)
            return null;
        const options = {
            // SVG元素
            target: e,
            // 动画播放开始时间点（毫秒）
            startTime: e.getNumberAttribute("start-time") || e.getNumberAttribute("startTime") || this.currentTime,
            // 动画播放结束时间点（毫秒）
            endTime: Math.min(e.getNumberAttribute("end-time") || e.getNumberAttribute("endTime") || Infinity, this.config.duration)
        };
        // 实例化SVG动画对象
        const svgAnimation = new SvgAnimation(options);
        // 将对象加入媒体调度列表
        this.dispatchMedias.push(svgAnimation);
        return svgAnimation;
    }

    /**
     * 将HTML视频元素转换为内部合成音频
     * 
     * @param {HTMLAudioElement} e - 视频元素
     */
    convertToInnerAudio(e) {
        // 获取seek时间
        const currentTimeAttribute = e.getNumberAttribute("currentTime");
        const audioId = this.audioId++;
        const options = {
            // 内部音频唯一ID
            id: audioId,
            // 音频来源
            url: this._currentUrlJoin(e.getAttribute("src")) || undefined,
            // 音频格式
            format: e.getAttribute("format") || undefined,
            // 音频开始时间点（毫秒）
            startTime: e.getNumberAttribute("start-time") || e.getNumberAttribute("startTime") || this.currentTime,
            // 音频结束时间点（毫秒）
            endTime: Math.min(e.getNumberAttribute("end-time") || e.getNumberAttribute("endTime") || Infinity, this.config.duration),
            // 音频裁剪开始时间点（毫秒）
            seekStart: e.getNumberAttribute("seek-start") || e.getNumberAttribute("seekStart") || (currentTimeAttribute ? currentTimeAttribute * 1000 : undefined),
            // 音频裁剪结束时间点（毫秒）
            seekEnd: e.getNumberAttribute("seek-end") || e.getNumberAttribute("seekEnd"),
            // 音频淡入时长（毫秒）
            fadeInDuration: e.getNumberAttribute("fade-in-duration") || e.getNumberAttribute("fadeInDuration"),
            // 音频淡出时长（毫秒）
            fadeOutDuration: e.getNumberAttribute("fade-out-duration") || e.getNumberAttribute("fadeOutDuration"),
            // 音频音量
            volume: (e.getNumberAttribute("volume") || e.volume || 1) * 100,
            // 音频是否循环播放
            loop: e.getBooleanAttribute("loop"),
            // 音频是否自动播放
            autoplay: e.getBooleanAttribute("autoplay"),
            // 音频是否静音
            muted: e.getBooleanAttribute("muted"),
            // 拉取失败时重试拉取次数
            retryFetchs: e.getNumberAttribute("retry-fetchs") || e.getNumberAttribute("retryFetchs"),
            // 是否忽略本地缓存
            ignoreCache: e.getBooleanAttribute("ignore-cache") || e.getBooleanAttribute("ignoreCache")
        };
        e.____onRemoved = () => ____updateAudioEndTime(audioId, this.currentTime);
        ____addAudio(options);
    }

    /**
     * 将HTML视频元素转换为视频画布
     * 
     * @param {HTMLVideoElement} e - 视频元素
     */
    convertToVideoCanvas(e) {
        // 获取seek时间
        const currentTimeAttribute = e.getNumberAttribute("currentTime");
        const options = {
            // 元素ID
            id: e.getAttribute("id") || undefined,
            // 元素类名
            class: e.getAttribute("class") || undefined,
            // 内部音频唯一ID
            audioId: this.audioId++,
            // 视频来源
            url: this._currentUrlJoin(e.getAttribute("src")) || undefined,
            // 蒙版视频来源
            maskUrl: this._currentUrlJoin(e.getAttribute("_maskSrc") || e.getAttribute("maskSrc")) || undefined,
            // 视频格式
            format: e.getAttribute("format") || undefined,
            // 视频宽度
            width: e.getNumberAttribute("width") || e.width,
            // 视频高度
            height: e.getNumberAttribute("height") || e.height,
            // 视频开始时间点（毫秒）
            startTime: e.getNumberAttribute("start-time") || e.getNumberAttribute("startTime") || this.currentTime,
            // 视频结束时间点（毫秒）
            endTime: Math.min(e.getNumberAttribute("end-time") || e.getNumberAttribute("endTime") || Infinity, this.config.duration),
            // 音频淡入时长（毫秒）
            fadeInDuration: e.getNumberAttribute("fade-in-duration") || e.getNumberAttribute("fadeInDuration"),
            // 音频淡出时长（毫秒）
            fadeOutDuration: e.getNumberAttribute("fade-out-duration") || e.getNumberAttribute("fadeOutDuration"),
            // 视频裁剪开始时间点（毫秒）
            seekStart: e.getNumberAttribute("seek-start") || e.getNumberAttribute("seekStart") || (currentTimeAttribute ? currentTimeAttribute * 1000 : undefined),
            // 视频裁剪结束时间点（毫秒）
            seekEnd: e.getNumberAttribute("seek-end") || e.getNumberAttribute("seekEnd"),
            // 视频是否循环播放
            loop: e.getBooleanAttribute("loop"),
            // 视频音频音量
            volume: (e.getNumberAttribute("volume") || e.volume || 1) * 100,
            // 视频是否自动播放
            autoplay: e.getBooleanAttribute("autoplay"),
            // 解码器硬件加速方法提示
            hardwareAcceleration: this.config.videoDecoderHardwareAcceleration,
            // 视频是否静音
            muted: e.getBooleanAttribute("muted"),
            // 拉取失败时重试拉取次数
            retryFetchs: e.getNumberAttribute("retry-fetchs") || e.getNumberAttribute("retryFetchs"),
            // 是否忽略本地缓存
            ignoreCache: e.getBooleanAttribute("ignore-cache") || e.getBooleanAttribute("ignoreCache"),
        };
        let canvas;
        if (!(e instanceof HTMLCanvasElement)) {
            // 创建画布元素
            canvas = this._createCanvas(options);
            // 复制目标元素样式
            this._copyElementStyle(e, canvas);
            // 代理目标元素所有属性和行为
            this._buildElementProxy(e, canvas);
            // 将目标元素替换为画布
            e.replaceWith(canvas);
        }
        else {
            canvas = e;
            canvas.width = 0;
            canvas.height = 0;
        }
        // 实例化视频画布实例
        const videoCanvas = new VideoCanvas(options);
        // 绑定画布元素
        videoCanvas.bind(canvas);
        // 将对象加入媒体调度列表
        this.dispatchMedias.push(videoCanvas);
        return videoCanvas;
    }

    /**
     * 将HTML图像元素转换为动态图像
     * 
     * @param {HTMLImageElement} e - 图像HTML元素
     */
    convertToDynamicImage(e) {
        const options = {
            // 元素ID
            id: e.getAttribute("id") || undefined,
            // 元素类名
            class: e.getAttribute("class") || undefined,
            // 图像来源
            url: this._currentUrlJoin(e.getAttribute("src")) || undefined,
            // 图像格式
            format: e.getAttribute("format") || undefined,
            // 图像宽度
            width: e.getNumberAttribute("width") || e.width,
            // 图像高度
            height: e.getNumberAttribute("height") || e.height,
            // 图像播放开始时间点（毫秒）
            startTime: e.getNumberAttribute("start-time") || e.getNumberAttribute("startTime") || this.currentTime,
            // 图像播放结束时间点（毫秒）
            endTime: Math.min(e.getNumberAttribute("end-time") || e.getNumberAttribute("endTime") || Infinity, this.config.duration),
            // 是否循环播放
            loop: e.getBooleanAttribute("loop"),
            // 拉取失败时重试拉取次数
            retryFetchs: e.getNumberAttribute("retry-fetchs") || e.getNumberAttribute("retryFetchs")
        };
        let canvas;
        if (!(e instanceof HTMLCanvasElement)) {
            // 创建画布元素
            canvas = this._createCanvas(options);
            // 复制目标元素样式
            this._copyElementStyle(e, canvas);
            // 代理目标元素所有属性和行为
            this._buildElementProxy(e, canvas);
            // 将目标元素替换为画布
            e.replaceWith(canvas);
        }
        else {
            canvas = e;
            canvas.width = 0;
            canvas.height = 0;
        }
        // 实例化动态图像实例
        const dynamicImage = new DynamicImage(options);
        // 绑定画布元素
        dynamicImage.bind(canvas);
        // 将对象加入媒体调度列表
        this.dispatchMedias.push(dynamicImage);
        return dynamicImage;
    }

    /**
     * 将HTMLLottie元素转换为Lottie画布
     * 
     * @param {HTMLElement} e - LottieHTML元素
     */
    convertToLottieCanvas(e) {
        const options = {
            // 元素ID
            id: e.getAttribute("id") || undefined,
            // 元素类名
            class: e.getAttribute("class") || undefined,
            // lottie来源
            url: this._currentUrlJoin(e.getAttribute("src")) || undefined,
            // 动画宽度
            width: parseInt(e.style.width) || e.getNumberAttribute("width"),
            // 动画宽度
            height: parseInt(e.style.height) || e.getNumberAttribute("height"),
            // 动画播放开始时间点（毫秒）
            startTime: e.getNumberAttribute("start-time") || e.getNumberAttribute("startTime") || this.currentTime,
            // 动画播放结束时间点（毫秒）
            endTime: Math.min(e.getNumberAttribute("end-time") || e.getNumberAttribute("endTime") || Infinity, this.config.duration),
            // 是否循环播放
            loop: e.getBooleanAttribute("loop"),
            // 拉取失败时重试拉取次数
            retryFetchs: e.getNumberAttribute("retry-fetchs") || e.getNumberAttribute("retryFetchs")
        };
        let canvas;
        if (!(e instanceof HTMLCanvasElement)) {
            // 创建画布元素
            canvas = this._createCanvas(options);
            // 复制目标元素样式
            this._copyElementStyle(e, canvas);
            // 代理目标元素所有属性和行为
            this._buildElementProxy(e, canvas);
            // 将目标元素替换为画布
            e.replaceWith(canvas);
        }
        else {
            canvas = e;
            canvas.width = 0;
            canvas.height = 0;
        }
        // 实例化Lottie动画实例
        const lottieCanvas = new LottieCanvas(options);
        // 绑定画布元素
        lottieCanvas.bind(canvas);
        // 将对象加入媒体调度列表
        this.dispatchMedias.push(lottieCanvas);
        return lottieCanvas;
    }

    /**
     * 抛出错误中断捕获
     * 
     * @param {number} code 错误码
     * @param {number} message 错误消息
     */
    throwError(code, message) {
        ____throwError(code, message);
    }

    /**
     * 复制元素样式
     * 
     * @private
     * @param {HTMLElement} source - 被复制HTML元素
     * @param {HTMLElement} target - 新元素
     */
    _copyElementStyle(source, target) {
        const sourceStyle = window.getComputedStyle(source);
        for (var i = 0; i < sourceStyle.length; i++) {
            var property = sourceStyle[i];
            var value = sourceStyle.getPropertyValue(property);
            target.style.setProperty(property, value);
        }
    }

    /**
     * 建立元素代理
     * 将对旧元素的所有行为代理到新元素
     * 
     * @private
     * @param {HTMLElement} source - 被代理HTML元素
     * @param {HTMLElement} target - 新元素
     */
    _buildElementProxy(source, target) {
        // 监听元素
        Object.defineProperties(source, {
            textContent: { get: () => target.textContent, set: v => target.textContent = v },
            innerHTML: { get: () => target.innerHTML, set: v => target.innerHTML = v },
            innerText: { get: () => target.innerText, set: v => target.innerText = v },
            setHTML: { get: () => target.setHTML, set: v => target.setHTML = v },
            getInnerHTML: { get: () => target.getInnerHTML, set: v => target.getInnerHTML = v },
            getRootNode: { get: () => target.getRootNode, set: v => target.getRootNode = v },
            value: { get: () => target.value, set: v => target.value = v },
            style: { get: () => target.style, set: v => target.style = v },
            src: { get: () => target.src, set: v => target.src = v },
            classList: { get: () => target.classList, set: v => target.classList = v },
            className: { get: () => target.className, set: v => target.className = v },
            hidden: { get: () => target.hidden, set: v => target.hidden = v },
            animate: { get: () => target.animate, set: v => target.animate = v },
            attributes: { get: () => target.attributes, set: v => target.attributes = v },
            childNodes: { get: () => target.childNodes, set: v => target.childNodes = v },
            children: { get: () => target.children, set: v => target.children = v },
            addEventListener: { get: () => target.addEventListener, set: v => target.addEventListener = v },
            removeEventListener: { get: () => target.removeEventListener, set: v => target.removeEventListener = v },
            append: { get: () => target.append, set: v => target.append = v },
            appendChild: { get: () => target.appendChild, set: v => target.appendChild = v },
            prepend: { get: () => target.prepend, set: v => target.prepend = v },
            replaceChild: { get: () => target.replaceChild, set: v => target.replaceChild = v },
            replaceChildren: { get: () => target.replaceChildren, set: v => target.replaceChildren = v },
            removeChild: { get: () => target.removeChild, set: v => target.removeChild = v },
            blur: { get: () => target.blur, set: v => target.blur = v },
            title: { get: () => target.title, set: v => target.title = v },
            toString: { get: () => target.toString, set: v => target.toString = v },
            autofocus: { get: () => target.autofocus, set: v => target.autofocus = v },
            parentElement: { get: () => target.parentElement, set: v => target.parentElement = v },
            parentNode: { get: () => target.parentNode, set: v => target.parentNode = v },
            clientWidth: { get: () => target.clientWidth, set: v => target.clientWidth = v },
            clientHeight: { get: () => target.clientHeight, set: v => target.clientHeight = v },
            clientTop: { get: () => target.clientTop, set: v => target.clientTop = v },
            clientLeft: { get: () => target.clientLeft, set: v => target.clientLeft = v },
            removeAttribute: { get: () => target.removeAttribute, set: v => target.removeAttribute = v },
            removeAttributeNode: { get: () => target.removeAttributeNode, set: v => target.removeAttributeNode = v },
            removeAttributeNS: { get: () => target.removeAttributeNS, set: v => target.removeAttributeNS = v },
            setAttribute: { get: () => target.setAttribute, set: v => target.setAttribute = v },
            setAttributeNS: { get: () => target.setAttributeNS, set: v => target.setAttributeNS = v },
            setAttributeNode: { get: () => target.setAttributeNode, set: v => target.setAttributeNode = v },
            setAttributeNodeNS: { get: () => target.setAttributeNodeNS, set: v => target.setAttributeNodeNS = v },
            getAttributeNames: { get: () => target.getAttributeNames, set: v => target.getAttributeNames = v },
            getAttribute: { get: () => target.getAttribute, set: v => target.getAttribute = v },
            getAttributeNS: { get: () => target.getAttributeNS, set: v => target.getAttributeNS = v },
            getAttributeNode: { get: () => target.getAttributeNode, set: v => target.getAttributeNode = v },
            getAttributeNodeNS: { get: () => target.getAttributeNodeNS, set: v => target.getAttributeNodeNS = v },
            hasAttribute: { get: () => target.hasAttribute, set: v => target.hasAttribute = v },
            hasAttributeNS: { get: () => target.hasAttributeNS, set: v => target.hasAttributeNS = v },
            hasAttributes: { get: () => target.hasAttributes, set: v => target.hasAttributes = v },
            hasChildNodes: { get: () => target.hasChildNodes, set: v => target.hasChildNodes = v },
            hasOwnProperty: { get: () => target.hasOwnProperty, set: v => target.hasOwnProperty = v },
            offsetParent: { get: () => target.offsetParent, set: v => target.offsetParent = v },
            offsetTop: { get: () => target.offsetTop, set: v => target.offsetTop = v },
            offsetLeft: { get: () => target.offsetLeft, set: v => target.offsetLeft = v },
            offsetWidth: { get: () => target.offsetWidth, set: v => target.offsetWidth = v },
            offsetHeight: { get: () => target.offsetHeight, set: v => target.offsetHeight = v },
            hasChildNodes: { get: () => target.hasChildNodes, set: v => target.hasChildNodes = v },
            getAnimations: { get: () => target.getAnimations, set: v => target.getAnimations = v },
            scroll: { get: () => target.scroll, set: v => target.scroll = v },
            scrollBy: { get: () => target.scrollBy, set: v => target.scrollBy = v },
            scrollIntoView: { get: () => target.scrollIntoView, set: v => target.scrollIntoView = v },
            scrollIntoViewIfNeeded: { get: () => target.scrollIntoViewIfNeeded, set: v => target.scrollIntoViewIfNeeded = v },
            scrollTop: { get: () => target.scrollTop, set: v => target.scrollTop = v },
            scrollLeft: { get: () => target.scrollLeft, set: v => target.scrollLeft = v },
            scrollWidth: { get: () => target.scrollWidth, set: v => target.scrollWidth = v },
            scrollHeight: { get: () => target.scrollHeight, set: v => target.scrollHeight = v },
            dataset: { get: () => target.dataset, set: v => target.dataset = v },
            insert: { get: () => target.insert, set: v => target.insert = v },
            insertBefore: { get: () => target.insertBefore, set: v => target.insertBefore = v },
            before: { get: () => target.before, set: v => target.before = v },
            firstChild: { get: () => target.firstChild, set: v => target.firstChild = v },
            firstElementChild: { get: () => target.firstElementChild, set: v => target.firstElementChild = v },
            lastChild: { get: () => target.lastChild, set: v => target.lastChild = v },
            lastElementChild: { get: () => target.lastElementChild, set: v => target.lastElementChild = v },
            closest: { get: () => target.closest, set: v => target.closest = v },
            valueOf: { get: () => target.valueOf, set: v => target.valueOf = v },
            click: { get: () => target.click, set: v => target.click = v },
            cloneNode: { get: () => target.cloneNode, set: v => target.cloneNode = v },
            nodeName: { get: () => target.nodeName, set: v => target.nodeName = v },
            nodeType: { get: () => target.nodeType, set: v => target.nodeType = v },
            nodeValue: { get: () => target.nodeValue, set: v => target.nodeValue = v },
            normalize: { get: () => target.normalize, set: v => target.normalize = v },
            matches: { get: () => target.matches, set: v => target.matches = v },
            play: { get: () => () => { } },
            pause: { get: () => () => { } }
        });
        source.remove = () => target.remove();
    }

    /**
     * 拉取响应
     * 
     * @param {string} url - 拉取URL
     * @param {Object} options - 拉取选项
     * @param {number} [options.method="GET"] - 请求方法
     * @param {number} [options.body] - 请求体
     * @param {number} [options.retryFetchs=2] - 重试次数
     * @param {number} [options.retryDelay=500] - 重试延迟
     * @returns {Response} - 响应对象
     */
    async fetch(url, options = {}, _retryIndex = 0) {
        const { retryFetchs = 2, retryDelay = 500, ...fetchOptions } = options;
        return await new Promise((resolve, reject) => {
            fetch(url, fetchOptions)
                .then(async response => {
                    if (response.status >= 500)
                        throw new Error(`Failed to load resource: [${fetchOptions.method || "GET"}] ${response.url} - [${response.status}] ${response.statusText}\n${await response.text()}`);
                    else if (response.status >= 400)
                        resolve(null);
                    else
                        resolve(response);
                })
                .catch(err => {
                    if (_retryIndex >= retryFetchs)
                        reject(err);
                    else
                        ____setTimeout(() => this.fetch(url, options, _retryIndex + 1), retryDelay);
                });
        });
    }

}

/**
 * 字体
 */
class Font {

    /** @type {string} - 字体URL */
    url;
    /** @type {string} - 字体路径 */
    path;
    /** @type {string} - 字体集名称 */
    family;
    /** @type {string} - 字体样式 */
    style;
    /** @type {number|string} - 字体粗细 */
    weight;
    /** @type {string} - 字体格式 */
    format;
    /** @type {number} - 重试拉取次数 */
    retryFetchs;
    /** @type {boolean} - 是否忽略本地缓存 */
    ignoreCache;
    /** @type {string} - 临时路径 */
    tmpDirPath = path.resolve("tmp/local_font/");
    /** @type {string} - 内部字体URL */
    #innerURL;
    /** @type {Promise} - 加载承诺 */
    #loadPromise;

    /**
     * 构造函数
     * 
     * @param {Object} options - 字体选项
     * @param {string} [options.url] - 字体URL
     * @param {string} [options.path] - 字体路径
     * @param {string} options.family - 字体集名称
     * @param {string} [options.format] - 字体格式
     * @param {string} [options.style] - 字体样式
     * @param {number|string} [options.weight] - 字体粗细
     * @param {number} [options.retryFetchs=2] - 重试拉取次数
     * @param {boolean} [options.ignoreCache=false] - 是否忽略本地缓存
     */
    constructor(options) {
        assert(_.isObject(options), "Font options must be Object");
        const { url, path: _path, family, format, style, weight, retryFetchs, ignoreCache } = options;
        assert(_.isString(url) || _.isString(_path), "Font path or url must be string");
        assert(_.isString(family), "Font family must be string");
        assert(_.isUndefined(format) || _.isString(format), "Font format must be string");
        assert(_.isUndefined(style) || _.isString(style), "Font style must be string");
        assert(_.isUndefined(weight) || _.isFinite(weight) || _.isString(weight), "Font weight must be number or string");
        assert(_.isUndefined(retryFetchs) || _.isFinite(retryFetchs), "Font retryFetchs must be number");
        assert(_.isUndefined(ignoreCache) || _.isBoolean(ignoreCache), "Font fadeOutDuration must be boolean");
        this.url = url;
        this.path = _.isString(_path) ? path.resolve(_path) : _path;
        this.family = family;
        if(format)
            this.format = format;
        if(this.url)
            this.format = util.getURLExtname(this.url);
        else if(this.path)
            this.format = util.getPathExtname(this.path);
        this.style = style;
        this.weight = _.isNumber(weight) ? parseInt(weight) : weight;
        this.retryFetchs = _.defaultTo(retryFetchs, 2);
        this.ignoreCache = _.defaultTo(ignoreCache, false);
    }

    /**
     * 资源加载
     */
    async load() {
        if (this.#loadPromise)
            return this.#loadPromise;
        this.#loadPromise = (async () => {
            await fs.ensureDir(this.tmpDirPath);
            if (this.path) {
                const filePath = this.path;
                if (!await fs.pathExists(filePath))
                    throw new Error(`Font source ${filePath} not exists`);
                if (!(await fs.stat(filePath)).isFile())
                    throw new Error(`Font source ${filePath} must be file`);
                const { dir, base } = path.parse(filePath);
                const dirPath = dir.replace(/:/g, "").replace(/\\/g, "/").toLowerCase();
                const destPath = path.join(this.tmpDirPath, dirPath, base);
                await fs.ensureDir(path.dirname(destPath), { recursive: true });
                await fs.copy(filePath, destPath);
                this.#innerURL = path.join("local_font/", dirPath, base).replace(/\\/g, "/");
            }
            else if(this.url)
                this.#innerURL = this.url;

        })();
        return this.#loadPromise;
    }

    /**
     * 转换为字体声明
     * 
     * @returns {string} - 字体声明
     */
    toFontFace() {
        assert(this.#innerURL, "Font not loaded");
        return  `@font-face{font-family:"${this.family}";${this.style ? `font-style:${this.style};` : ""}${this.weight ? `font-weight:${this.weight};` : ""}src:url("${this.#innerURL}") format("${this.format}")}`;
    }

}

/**
 * @typedef {import('puppeteer-core').Viewport} Viewport
 * @typedef {import('puppeteer-core').WaitForOptions} WaitForOptions
 */

// 默认用户UA
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0";
// 公共样式内容
const COMMON_STYLE_CONTENT = fs.readFileSync(util.rootPathJoin("lib/common.css"), "utf-8");
// MP4Box库脚本内容
const MP4BOX_LIBRARY_SCRIPT_CONTENT = fs.readFileSync(util.rootPathJoin("lib/mp4box.js"), "utf-8");
// Webfont库脚本内容
const FONTFACE_OBSERVER_SCRIPT_CONTENT = fs.readFileSync(util.rootPathJoin("lib/fontfaceobserver.js"), "utf-8");
// Lottie动画库脚本内容
const LOTTIE_LIBRARY_SCRIPT_CONTENT = fs.readFileSync(util.rootPathJoin("lib/lottie.js"), "utf-8");
// 页面计数
let pageIndex = 1;

/**
 * 页面
 */
class Page extends EventEmitter {

    /** 页面状态枚举 */
    static STATE = {
        /** 未初始化 */
        UNINITIALIZED: Symbol("UNINITIALIZED"),
        /** 已就绪 */
        READY: Symbol("READY"),
        /** 录制中 */
        CAPTURING: Symbol("CAPTURING"),
        /** 已暂停 */
        PAUSED: Symbol("PAUSED"),
        /** 已停止 */
        STOPPED: Symbol("STOPPED"),
        /** 不可用 */
        UNAVAILABLED: Symbol("UNAVAILABLED"),
        /** 已关闭 */
        CLOSED: Symbol("CLOSED")
    };

    id = `Page@${pageIndex++}`;
    /** @type {Page.STATE} */
    state = Page.STATE.UNINITIALIZED;
    /** @type {Browser} */
    parent;
    /** @type {_Page} */
    target;
    /** @type {number} - 页面视窗宽度 */
    width;
    /** @type {number} - 页面视窗高度 */
    height;
    /** @type {string} - 用户UA */
    userAgent;
    /** @type {number} - BeginFrame超时时间（毫秒） */
    beginFrameTimeout;
    /** @type {string} - 帧图格式（jpeg/png） */
    frameFormat;
    /** @type {number} - 帧图质量（0-100） */
    frameQuality;
    /** @type {number} - 背景不透明度（0-1） */
    backgroundOpacity = 1;
    /** @type {Font[]} - 已注册字体集 */
    fonts = [];
    /** @type {Object[]} - 已接受资源列表 */
    acceptResources = [];
    /** @type {Object[]} - 已拒绝资源列表 */
    rejectResources = [];
    /** @type {Object[]} - CSS动画列表 */
    cssAnimations = [];
    /** @type {{[key: number]: Function}} - CSS动画列表 */
    timeActions = {}
    /** @type {Set} - 资源排重Set */
    #resourceSet = new Set();
    /** @type {CDPSession} - CDP会话 */
    #cdpSession = null;
    /** @type {boolean} - 是否初始页面 */
    #firstPage = false;
    /** @type {AsyncLock} - */
    #asyncLock = new AsyncLock();

    /**
     * 构造函数
     * 
     * @param {Object} options - 页面选项
     * @property {number} [options.width] - 页面视窗宽度
     * @property {number} [options.height] - 页面视窗高度
     * @property {string} [options.userAgent] - 用户UA
     * @property {number} [options.beginFrameTimeout=5000] - BeginFrame超时时间（毫秒）
     * @property {string} [options.frameFormat="jpeg"] - 帧图格式（jpeg/png）
     * @property {number} [options.frameQuality=80] - 帧图质量（0-100）
     */
    constructor(parent, options) {
        super();
        assert(parent instanceof Browser, "Page parent must be Browser");
        this.parent = parent;
        assert(_.isObject(options), "Page options must provided");
        const { width, height, userAgent, beginFrameTimeout,
            frameFormat, frameQuality, _firstPage = false } = options;
        assert(_.isUndefined(width) || _.isFinite(width), "Page width must be number");
        assert(_.isUndefined(height) || _.isFinite(height), "Page height must be number");
        assert(_.isUndefined(userAgent) || _.isString(userAgent), "Page userAgent must be string");
        assert(_.isUndefined(beginFrameTimeout) || _.isFinite(beginFrameTimeout), "Page beginFrameTimeout must be number");
        assert(_.isUndefined(frameQuality) || _.isFinite(frameQuality), "Page frameQuality must be number");
        assert(_.isUndefined(frameFormat) || _.isString(frameFormat), "Page frameFormat must be string");
        assert(_.isBoolean(_firstPage), "Page _firstPage must be boolean");
        this.width = width;
        this.height = height;
        this.userAgent = _.defaultTo(userAgent, _.defaultTo(globalConfig.userAgent, DEFAULT_USER_AGENT));
        this.beginFrameTimeout = _.defaultTo(beginFrameTimeout, _.defaultTo(globalConfig.beginFrameTimeout, 5000));
        this.frameFormat = _.defaultTo(frameFormat, _.defaultTo(globalConfig.frameFormat, "jpeg"));
        this.frameQuality = _.defaultTo(frameQuality, _.defaultTo(globalConfig.frameQuality, 80));
        this.#firstPage = _firstPage;
    }

    /**
     * 初始化页面
     */
    async init() {
        await this.#asyncLock.acquire("init", async () => {
            // 如果是浏览器首个页面将复用已开启的第一个页面
            if (this.#firstPage)
                this.target = (await this.parent.target.pages())[0];
            else
                this.target = await this.parent.target.newPage();
            // 初始化渲染环境
            await this.#envInit();
            // 设置页面已就绪
            this.#setState(Page.STATE.READY);
        });
    }

    /**
     * 设置视窗
     * 
     * @param {Viewport} options - 视窗选项
     */
    async setViewport(options = {}) {
        const { width, height } = options;
        assert(_.isFinite(width), "Page viewport width must be number");
        assert(_.isFinite(height), "Page viewport height must be number");
        this.width = width;
        this.height = height;
        // 设置页面视窗
        await this.target.setViewport({
            ...options,
            width: Math.floor(width),
            height: Math.floor(height)
        });
    }

    /**
     * 导航URL
     * 
     * @param {string} url - 导航目标URL
     * @param {WaitForOptions} [waitForOptions] - 等待选项
     */
    async goto(url, waitForOptions) {
        assert(this.isReady(), "Page state must be ready");
        assert(util.isURL(url), "goto url is invalid");
        // 清除资源
        this.#resetStates();
        // 检查URL
        !globalConfig.allowUnsafeContext && this.#checkURL(url);
        // 开始CDP会话
        await this.#startCDPSession();
        // 监听CSS动画
        await this.#listenCSSAnimations();
        // 页面导航到URL
        await this.target.goto(url, waitForOptions);
        await Promise.all([
            // 注入公共样式
            this.#injectStyle(COMMON_STYLE_CONTENT),
            // 注入MP4Box库
            this.#injectLibrary(MP4BOX_LIBRARY_SCRIPT_CONTENT + ";window.____MP4Box = window.MP4Box;window.MP4Box = undefined"),
            // 注入Lottie动画库
            this.#injectLibrary(LOTTIE_LIBRARY_SCRIPT_CONTENT + ";window.____lottie = window.lottie;window.lottie = undefined")
        ]);
        // 初始化捕获上下文
        await this.target.evaluate(() => captureCtx.init());
    }

    /**
     * 设置页面内容
     * 
     * @param {string} content 页面内容
     * @param {WaitForOptions} [waitForOptions] - 等待选项
     */
    async setContent(content, waitForOptions) {
        assert(this.isReady(), "Page state must be ready");
        assert(_.isString(content), "page content must be string");
        await this.target.goto("about:blank");
        // 清除资源
        this.#resetStates();
        // 开始CDP会话
        await this.#startCDPSession();
        // 监听CSS动画
        await this.#listenCSSAnimations();
        await this.target.setContent(content, waitForOptions);
        await Promise.all([
            // 注入公共样式
            this.#injectStyle(COMMON_STYLE_CONTENT),
            // 注入MP4Box库
            this.#injectLibrary(MP4BOX_LIBRARY_SCRIPT_CONTENT + ";window.____MP4Box = window.MP4Box;window.MP4Box = undefined"),
            // 注入Lottie动画库
            this.#injectLibrary(LOTTIE_LIBRARY_SCRIPT_CONTENT + ";window.____lottie = window.lottie;window.lottie = undefined")
        ]);
        // 初始化捕获上下文
        await this.target.evaluate(() => captureCtx.init());
    }

    /**
     * 设置背景不透明度（0-1）
     * 
     * @param {number} [opacity=1] - 背景不透明度
     */
    setBackgroundOpacity(opacity = 1) {
        assert(this.isReady(), "Page state must be ready");
        assert(_.isFinite(opacity), "opacity must be number");
        this.backgroundOpacity = opacity;
    }

    /**
     * 注册字体
     * 
     * @param {Font} font - 字体对象
     */
    registerFont(font) {
        if (!(font instanceof Font))
            font = new Font(font);
        // 开始加载字体
        font.load();
        this.fonts.push(font);
    }

    /**
     * 注册多个字体
     * 
     * @param {Font[]} fonts - 字体对象列表
     */
    registerFonts(fonts = []) {
        fonts.forEach(font => this.registerFont(font));
    }

    /**
     * 注册动作序列
     * @param {Object} timeActions 
     */
    registerTimeActions(timeActions) {
        this.timeActions = { ...timeActions };
    }

    /**
     * 等待字体加载完成
     * 
     * @param {number} [timeout=30000] - 等待超时时间（毫秒）
     */
    async waitForFontsLoaded(timeout = 30000) {
        // 注入Webfont库
        await this.#injectLibrary(FONTFACE_OBSERVER_SCRIPT_CONTENT + ";window.____FontFaceObserver = FontFaceObserver");
        // 等待字体加载完成
        await Promise.all(this.fonts.map(font => font.load()));
        // 将所有字体声明拼接为样式
        const styles = this.fonts.reduce((style, font) => style + font.toFontFace(), "");
        // 添加样式标签到页面
        styles && await this.#injectStyle(styles);
        await this.target.evaluate(async _timeout => {
            const fonts = [...document.fonts];
            // 无字体则跳过加载
            if (fonts.length == 0)
                return;
            // 等待字体加载完成
            let timer;
            await Promise.race([
                Promise.all(fonts.map(font => new ____FontFaceObserver(font.family).load())),
                new Promise((_, reject) => timer = (window.____setTimeout || window.setTimeout)(reject, _timeout))
            ]);
            (window.____clearTimeout || window.clearTimeout)(timer);
        }, timeout);
    }

    /**
     * 注入样式
     * 
     * @param {string} content - 样式内容
     */
    async #injectStyle(content) {
        assert(_.isString(content), "inject style content must be string");
        await this.target.addStyleTag({
            content
        });
    }

    /**
     * 注入脚本库
     * 
     * @param {string} content - 脚本内容
     */
    async #injectLibrary(content) {
        assert(_.isString(content), "inject script content must be string");
        await this.target.addScriptTag({
            content
        });
    }

    /**
     * 开始录制
     * 
     * @param {Object} [options] - 录制选项
     * @param {number} [options.fps] - 渲染帧率
     * @param {number} [options.startTime=0] - 渲染开始事件点（毫秒）
     * @param {number} [options.duration] - 渲染时长（毫秒）
     * @param {number} [options.frameCount] - 渲染总帧数
     * @param {boolean} [options.autostart=true] - 是否自动启动渲染
     */
    async startScreencast(options = {}) {
        await this.#asyncLock.acquire("startScreencast", async () => {
            let { fps, startTime = 0, duration, frameCount, autostart = true, videoDecoderHardwareAcceleration } = options;
            assert(this.isReady(), "Page state must be ready");
            assert(_.isUndefined(fps) || _.isFinite(fps), "fps must be number");
            assert(_.isFinite(startTime), "startTime must be number");
            assert(_.isUndefined(duration) || _.isFinite(duration), "duration must be number");
            assert(_.isUndefined(frameCount) || _.isFinite(frameCount), "frameCount must be number");
            assert(_.isUndefined(videoDecoderHardwareAcceleration) || _.isString(videoDecoderHardwareAcceleration), "videoDecoderHardwareAcceleration must be string");
            // 指定时长时将计算总帧数
            if (_.isFinite(duration))
                frameCount = util.durationToFrameCount(duration, fps);
            else if (_.isFinite(frameCount))
                duration = util.frameCountToDuration(frameCount, fps);
            // 页面进入捕获中状态
            this.#setState(Page.STATE.CAPTURING);
            // 当当前视图与设定不一致时进行调整
            const { width, height, ..._options } = this.target.viewport() || {};
            if (width != this.width || height != this.height)
                await this.setViewport({ width, height, ..._options });
            // 应用背景不透明度
            await this.#applyBackgroundOpacity();
            // 将鼠标移动到屏幕中央
            await this.target.mouse.move(width / 2, height / 2);
            // 如果设置帧率或者总帧数将覆盖页面中设置的帧率和总帧数
            await this.target.evaluate(async config => {
                // 注入配置选项
                Object.assign(captureCtx.config, config);
                // 如果准备后还未启动且自动启动选项开启时渲染则开始
                !captureCtx.ready() && captureCtx.config.autostart && captureCtx.start();
            }, _.pickBy({ fps, startTime, duration, frameCount, autostart, videoDecoderHardwareAcceleration }, v => !_.isUndefined(v)));
        });
    }

    /**
     * 暂停录制
     */
    async pauseScreencast() {
        assert(this.isCapturing(), "Page state is not capturing, unable to pause");
        await this.target.evaluate(async () => captureCtx.pauseFlag = true);
        this.#setState(Page.STATE.PAUSED);
    }

    /**
     * 恢复录制
     */
    async resumeScreencast() {
        assert(this.isPaused(), "Page state is not paused, unable to resume");
        await this.target.evaluate(async () => {
            if (captureCtx.resumeCallback) {
                captureCtx.resumeCallback();
                captureCtx.resumeCallback = null;
            }
            captureCtx.pauseFlag = false;
        });
        this.#setState(Page.STATE.CAPTURING);
    }

    /**
     * 停止录制
     */
    async stopScreencast() {
        await this.#asyncLock.acquire("stopScreencast", async () => {
            await this.target.evaluate(async () => captureCtx.stopFlag = true);
            await this.#endCDPSession();
            this.#setState(Page.STATE.STOPPED);
        });
    }

    /**
     * @typedef {Object} CaptureContextConfig
     * @property {number} fps - 捕获帧率
     * @property {number} frameCount - 捕获总帧数
     */
    /**
     * 获取捕获上下文配置
     * 
     * @returns {CaptureContextConfig} - 配置对象
     */
    async getCaptureContextConfig() {
        return await this.target.evaluate(() => captureCtx.config);
    }

    /**
     * 发送错误事件
     * 
     * @param {Error} err - 错误对象
     */
    #emitError(err) {
        if (err.message.indexOf("Another frame is pending") != -1)
            err = new Error("Page rendering has been interrupted");
        if (this.eventNames().indexOf("error") != -1)
            this.emit("error", err);
        else
            logger.error("Page error:", err);
    }

    /**
     * 发送崩溃事件
     * 
     * @param {Error} err - 错误对象
     */
    #emitCrashed(err) {
        // 设置页面为不可用
        this.#setState(Page.STATE.UNAVAILABLED);
        if (this.eventNames().indexOf("crashed") != -1)
            this.emit("crashed", err);
        else
            logger.error("Page crashed:", err);
    }

    /**
     * 发送录制完成事件
     */
    #emitScreencastCompleted() {
        this.emit("screencastCompleted");
    }

    /**
     * 环境初始化
     */
    async #envInit() {
        // 设置UserAgent防止页面识别HeadlessChrome
        await this.target.setUserAgent(this.userAgent);
        // 禁用CSP策略
        await this.target.setBypassCSP(true);
        // 拦截请求
        await this.target.setRequestInterception(true);
        // 页面控制台输出
        this.target.on("console", message => {
            const type = message.type();
            const text = message.text();
            // 错误消息处理
            if (type === "error") {
                if (text.indexOf("Failed to load resource: the server responded with a status of ") != -1)
                    return;
                this.emit("consoleError", new PageError(text));
            }
            // 其它消息处理
            else
                this.emit("consoleLog", text);
        });
        // 页面加载完成事件
        this.target.on("domcontentloaded", async () => {
            // 如果处于录制状态作为被动刷新处理
            if (this.isCapturing())
                this.#emitError(new Error("Page context is missing, possibly due to the page being refreshed"));
        });
        // 页面请求处理
        this.target.on("request", this.#requestHandle.bind(this));
        // 页面响应处理
        this.target.on("response", this.#responseHandle.bind(this));
        // 页面错误回调
        this.target.on("pageerror", err => this.emit("consoleError", new PageError(err)));
        // 页面崩溃回调
        this.target.once("error", this.#emitCrashed.bind(this));
        // 页面关闭回调
        this.target.once("close", this.close.bind(this));
        // 暴露录制完成函数
        await this.target.exposeFunction("____screencastCompleted", this.#emitScreencastCompleted.bind(this));
        // 暴露CSS动画控制函数
        await this.target.exposeFunction("____seekCSSAnimations", this.#seekCSSAnimations.bind(this));
        // 暴露动作序列
        await this.target.exposeFunction("____seekTimeActions", this.#seekTimeActions.bind(this));
        // 暴露跳帧函数
        await this.target.exposeFunction("____skipFrame", this.#skipFrame.bind(this));
        // 暴露下一帧函数
        await this.target.exposeFunction("____captureFrame", this.#captureFrame.bind(this));
        // 暴露添加音频函数
        await this.target.exposeFunction("____addAudio", this.#addAudio.bind(this));
        await this.target.exposeFunction("____updateAudioEndTime", this.#updateAudioEndTime.bind(this));
        // 暴露抛出错误函数
        await this.target.exposeFunction("____throwError", (code = -1, message = "") => this.#emitError(new Error(`throw error: [${code}] ${message}`)));
        // 页面加载前进行上下文初始化
        await this.target.evaluateOnNewDocument(`
            window.____util=(${innerUtil})();
            window.____MP4Demuxer=${MP4Demuxer};
            window.____SvgAnimation=${SvgAnimation};
            window.____VideoCanvas=${VideoCanvas};
            window.____DynamicImage=${DynamicImage};
            window.____LottieCanvas=${LottieCanvas};
            window.____CaptureContext=${CaptureContext};
            window.captureCtx=new ____CaptureContext();
        `);
    }

    /**
     * seek所有CSS动画
     */
    async #seekCSSAnimations(currentTime) {
        if (this.cssAnimations.length === 0)
            return;
        const pauseAnimationIds = [];
        const seekPromises = [];
        this.cssAnimations = this.cssAnimations.filter(animation => {
            if (animation.startTime == null)
                pauseAnimationIds.push(animation.id);
            animation.startTime = _.defaultTo(animation.startTime, currentTime);
            const animationCurrentTime = Math.floor(currentTime - animation.startTime);
            if (animationCurrentTime < 0)
                return true;
            seekPromises.push(this.#cdpSession.send("Animation.seekAnimations", {
                animations: [animation.id],
                currentTime: animationCurrentTime
            }));
            if (animationCurrentTime >= (animation.duration * (animation.iterations || Infinity)) + animation.delay)
                return false;
            return true;
        });
        // 暂停动画
        if (pauseAnimationIds.length > 0) {
            await this.#cdpSession.send("Animation.setPaused", {
                animations: pauseAnimationIds,
                paused: true
            });
        }
        // 调度动画
        await Promise.all(seekPromises);
    }

    /**
     * seek所有时间轴动作
     */
    async #seekTimeActions(currentTime) {
        currentTime = parseInt(currentTime);
        const matchTimeNodes = Object.keys(this.timeActions)
            .map(Number)
            .sort()
            .find(time => currentTime >= time);
        if(!matchTimeNodes)
            return;
        const timeAction = this.timeActions[matchTimeNodes];
        delete this.timeActions[matchTimeNodes];
        try {
            const result = timeAction(this);
            if(result instanceof Promise)
                await result.catch(err => this.#emitError(err));
        }
        catch(err) {
            this.#emitError(err);
        }
    }

    /**
     * 跳过帧
     */
    async #skipFrame() {
        if (globalConfig.compatibleRenderingMode)
            return;
        let timer;
        // 帧数据捕获
        const frameData = await Promise.race([
            this.#cdpSession.send("HeadlessExperimental.beginFrame"),
            // 帧渲染超时处理
            new Promise(resolve => timer = setTimeout(() => resolve(false), this.beginFrameTimeout))
        ]);
        clearTimeout(timer);
        // 帧渲染超时处理
        if (frameData === false) {
            this.#setState(Page.STATE.UNAVAILABLED);
            throw new Error("beginFrame wait timeout");
        }
    }

    /**
     * 捕获帧
     */
    async #captureFrame() {
        try {
            // 非兼容渲染模式使用BeginFrame API进行捕获否则使用截图API
            const frameFormat = this.backgroundOpacity < 1 ? "png" : this.frameFormat;
            if (!globalConfig.compatibleRenderingMode) {
                let timer;
                // 帧数据捕获
                const frameData = await Promise.race([
                    this.#cdpSession.send("HeadlessExperimental.beginFrame", {
                        screenshot: {
                            // 帧图格式（jpeg, png)
                            format: frameFormat,
                            // 帧图质量（0-100）
                            quality: frameFormat == "jpeg" ? this.frameQuality : undefined
                        }
                    }),
                    // 帧渲染超时处理
                    new Promise(resolve => timer = setTimeout(() => resolve(false), this.beginFrameTimeout))
                ]);
                clearTimeout(timer);
                // 帧渲染超时处理
                if (frameData === false) {
                    this.#setState(Page.STATE.UNAVAILABLED);
                    throw new Error("beginFrame wait timeout");
                }
                if (!frameData || !frameData.screenshotData) return true;
                this.emit("frame", Buffer.from(frameData.screenshotData, "base64"));
            }
            else {
                const screenshotData = await this.target.screenshot({
                    type: frameFormat,
                    quality: frameFormat == "jpeg" ? this.frameQuality : undefined,
                    optimizeForSpeed: true
                });
                // 帧数据回调
                this.emit("frame", screenshotData);
            }
            return true;
        }
        catch (err) {
            this.#emitError(err);
            return false;
        }
    }

    /**
     * 添加音频
     * 
     * @param {Audio} options 
     */
    #addAudio(options) {
        this.emit("audioAdd", new Audio(options));
    }

    /**
     * 更新音频结束时间点
     * 
     * @param {number} audioId - 内部音频ID
     * @param {number} endTime - 音频结束时间点
     */
    #updateAudioEndTime(audioId, endTime) {
        this.emit("audioUpdate", audioId, { endTime });
    }

    /**
     * 预处理视频
     * 
     * @param {VideoConfig} config - 视频配置
     */
    async #preprocessVideo(config) {
        const videoPreprocessor = this.videoPreprocessor;
        this.emit("videoPreprocess", config);
        const { audio, buffer } = await videoPreprocessor.process(config);
        audio && this.emit("audioAdd", audio);
        return buffer;
    }

    /**
     * 开始CDP会话
     */
    async #startCDPSession() {
        this.#cdpSession && await this.#endCDPSession();
        this.#cdpSession = await this.target.createCDPSession();  //创建会话
    }

    /**
     * 应用背景透明度
     */
    async #applyBackgroundOpacity() {
        await this.#cdpSession.send("Emulation.setDefaultBackgroundColorOverride", {
            color: { r: 0, g: 0, b: 0, a: this.backgroundOpacity }
        });
    }

    /**
     * 监听CSS动画
     */
    async #listenCSSAnimations() {
        // 启用动画通知域
        await this.#cdpSession.send("Animation.enable");
        // 监听动画开始事件将动画属性添加到调度列表
        this.#cdpSession.on("Animation.animationStarted", animation => {
            this.cssAnimations.push({
                id: animation.animation.id,
                startTime: null,
                paused: false,
                backendNodeId: animation.animation.source.backendNodeId,
                delay: animation.animation.source.delay,
                duration: animation.animation.source.duration,
                iterations: animation.animation.source.iterations
            });
        });
    }

    /**
     * 结束CDP会话
     */
    async #endCDPSession() {
        if (!this.#cdpSession) return;
        await new Promise(resolve => {
            // 移除所有事件监听器
            this.#cdpSession.removeAllListeners();
            // 从页面卸载CDP会话
            this.#cdpSession.detach()
                .catch(err => this.emit("consoleError", err))
                .finally(() => {
                    this.#cdpSession = null;
                    resolve();
                });
        });
    }

    /**
     * 页面请求处理
     * 
     * @param {HTTPRequest} request - 页面请求
     */
    #requestHandle(request) {
        (async () => {
            // 如果是捕获中产生的跳转请求则终止
            if (this.isCapturing() && request.isNavigationRequest() && request.frame() === this.target.mainFrame()) {
                request.abort("aborted");
                return;
            }
            const method = request.method();
            const url = request.url();
            const { pathname } = new URL(url);
            // console.log(pathname);
            // 视频预处理API
            if (method == "POST" && pathname == "/api/video_preprocess") {
                const data = _.attempt(() => JSON.parse(request.postData()));
                if (_.isError(data))
                    throw new Error("api /api/video_preprocess only accept JSON data");
                const buffer = await this.#preprocessVideo(new VideoConfig(data));
                await request.respond({
                    status: 200,
                    body: buffer
                });
            }
            // 从本地拉取字体
            else if (method == "GET" && /^\/local_font\//.test(pathname)) {
                const filePath = path.join("tmp/local_font/", pathname.substring(12));
                if (!await fs.pathExists(filePath)) {
                    return await request.respond({
                        status: 404,
                        body: "File not exists"
                    });
                }
                else {
                    await request.respond({
                        status: 200,
                        body: await fs.readFile(filePath),
                        headers: {
                            // 要求浏览器缓存字体
                            "Cache-Control": "max-age=31536000"
                        }
                    });
                }
            }
            // 其它请求透传
            else
                await request.continue();
        })()
            .catch(err => {
                logger.error(err);
                // 发生错误响应500
                request.respond({
                    status: 500,
                    body: err.stack
                })
                    .catch(err => logger.error(err));
            });
    }

    /**
     * 页面响应处理
     * 
     * @param {HTTPResponse} response - HTTP响应
     */
    #responseHandle(response) {
        const status = response.status();
        const statusText = response.statusText();
        const method = response.request().method();
        const url = response.url();
        const id = `${method}:${url}`;
        if (this.#resourceSet.has(id))
            return;
        this.#resourceSet.add(id);
        const info = {
            status,
            statusText,
            method,
            url
        };
        if (status < 400) {
            this.acceptResources.push(info);
            this.emit("resourceAccepted", info);
        }
        else {
            this.rejectResources.push(info);
            const message = `Fetch response failed: [${method}] ${url} - [${status}] ${statusText}`;
            if (this.eventNames().indexOf("resourceError") != -1)
                this.emit("resourceRejected", new Error(message));
            else
                logger.error(message);
        }
    }

    /**
     * 重置页面
     */
    async reset() {
        await this.#asyncLock.acquire("reset", async () => {
            // 如果处于捕获状态则停止录制
            this.isCapturing() && await this.stopScreencast();
            // 如果CDP会话存在则结束会话
            this.#cdpSession && await this.#endCDPSession();
            // 移除监听器
            this.#removeListeners();
            // 清除资源
            this.#resetStates();
            this.#resourceSet = new Set();
            // 跳转空白页释放页面内存
            await this.target.goto("about:blank");
            // 设置页面状态为ready
            this.#setState(Page.STATE.READY);
        });
    }

    /**
     * 释放页面资源
     */
    async release() {
        await this.#asyncLock.acquire("release", async () => {
            // 重置页面
            await this.reset();
            // 通知浏览器释放页面
            await this.parent.releasePage(this);
            // 设置页面状态为ready
            this.#setState(Page.STATE.READY);
        });
    }

    /**
     * 关闭页面
     */
    async close() {
        await this.#asyncLock.acquire("close", async () => {
            if (this.isClosed())
                return;
            // 设置页面状态为closed
            this.#setState(Page.STATE.CLOSED);
            // 通知浏览器页面池销毁页面资源
            await this.parent.destoryPage(this);
            // 如果页面已关闭则跳过
            if (!this.target || this.target.isClosed())
                return;
            this.target.close();
            this.target = null;
        });
    }

    /**
     * 检查URL
     * 
     * @param {string} url - URL
     */
    #checkURL(url) {
        const { protocol, hostname, host } = new URL(url);
        if (protocol != "https:" && hostname != "127.0.0.1" && hostname != "localhost")
            throw new Error(`The URL ${protocol}//${host} is not a secure domain, which may cause security policies to disable some core features. Please use HTTPS protocol or http://localhost / http://127.0.0.1`);
    }

    /**
     * 重置状态
     */
    #resetStates() {
        this.backgroundOpacity = 1;
        this.fonts = [];
        this.acceptResources = [];
        this.rejectResources = [];
        this.cssAnimations = [];
        this.timeActions = {};
    }

    /**
     * 移除所有监听器
     */
    #removeListeners() {
        this.removeAllListeners("frame");
        this.removeAllListeners("screencastCompleted");
        this.removeAllListeners("consoleLog");
        this.removeAllListeners("consoleError");
        this.removeAllListeners("resourceAccepted");
        this.removeAllListeners("resourceRejected");
        this.removeAllListeners("videoPreprocess");
        this.removeAllListeners("audioAdd");
        this.removeAllListeners("audioUpdate");
        this.removeAllListeners("error");
        this.removeAllListeners("crashed");
    }

    /**
     * 设置页面资源状态
     * 
     * @param {Page.STATE} state 
     */
    #setState(state) {
        assert(_.isSymbol(state), "state must be Symbol");
        this.state = state;
    }

    /**
     * 是否未初始化
     * 
     * @returns {boolean} - 是否未初始化
     */
    isUninitialized() {
        return this.state == Page.STATE.UNINITIALIZED;
    }

    /**
     * 是否已就绪
     * 
     * @returns {boolean} - 是否已就绪
     */
    isReady() {
        return this.state == Page.STATE.READY;
    }

    /**
     * 是否正在捕获
     * 
     * @returns {boolean} - 是否正在捕获
     */
    isCapturing() {
        return this.state == Page.STATE.CAPTURING;
    }

    /**
     * 是否已暂停
     * 
     * @returns {boolean} - 是否已暂停
     */
    isPaused() {
        return this.state == Page.STATE.PAUSED;
    }

    /**
     * 是否不可用
     * 
     * @returns {boolean} - 是否不可用
     */
    isUnavailabled() {
        return this.state == Page.STATE.UNAVAILABLED;
    }

    /**
     * 是否已关闭
     * 
     * @returns {boolean} - 是否已关闭
     */
    isClosed() {
        return this.state == Page.STATE.CLOSED;
    }

    /**
     * 获取视频预处理器
     */
    get videoPreprocessor() {
        return this.parent.videoPreprocessor;
    }

}

class PageError extends Error {
    name = "PageError";
    constructor(message) {
        if (message instanceof Error)
            message = message.stack;
        super(message);
    }
}

// 默认浏览器安装路径
const browserInstallPath = ".bin";
// 默认浏览器名称
// 目前只限于chrome，如使用chromium可能会缺失H264解码功能
const browserName = browsers.Browser.CHROME;
// 默认浏览器版本号，不能低于119.0.6018.0，否则无法使用VideoDecoder解码H264
// 请参考：https://github.com/GoogleChromeLabs/chrome-for-testing/issues/18
const browserVersion = "119.0.6029.0";
// 下载进度条
const downloadProgressBar = new cliProgress.SingleBar({ hideCursor: true }, cliProgress.Presets.shades_classic);

/**
 * 安装浏览器
 * 
 * @param {string} installPath - 安装路径
 * @param {Object} [options] - 安装选项
 * @param {string} [options.name] - 安装浏览器名称
 * @param {string} [options.version] - 安装浏览器版本
 * @returns {Object} - 包含执行路径的对象
 */
async function installBrowser(installPath = browserInstallPath, options = {}) {

    assert(_.isString(installPath), "install path must be string");
    assert(_.isObject(options), "options must be Object");
    const { name = browserName, version = (globalConfig.browserVersion || browserVersion) } = options;
    assert(_.isString(name), "browser name must be string");
    assert(_.isString(version), "version must be string");

    let platform = os.platform();
    const arch = os.arch();

    // 根据不同平台架构选择浏览器平台
    if (platform == "win32") {
        if (arch == "x64")
            platform = browsers.BrowserPlatform.WIN64;
        else
            platform = browsers.BrowserPlatform.WIN32;
    }
    else if (platform == "darwin") {
        !globalConfig.compatibleRenderingMode && logger.warn("The headless browser of the Mac system may not be able to use the headless experimental API properly. Please enable compatible rendering mode: wvc.config({ compatibleRenderingMode: true }), which will result in a decrease in rendering efficiency.");
        if (arch == "arm64")
            platform = browsers.BrowserPlatform.MAC_ARM;
        else
            platform = browsers.BrowserPlatform.MAC;
    }
    else
        platform = browsers.BrowserPlatform.LINUX;

    // 获取buildId
    const buildId = await browsers.resolveBuildId(name, platform, version);
    installPath = path.resolve(installPath);
    const downloadOptions = {
        cacheDir: installPath,
        browser: name,
        platform,
        buildId
    };

    // 补全可执行文件路径
    const executablePath = browsers.computeExecutablePath(downloadOptions);
    // 如果不存在可执行文件则进行下载安装
    if (!await fs.pathExists(executablePath)) {
        logger.info(`Installing ${name} into ${installPath}`);
        let downloadStart = false;
        await browsers.install({
            ...downloadOptions,
            downloadProgressCallback: (downloadedBytes, totalBytes) => {
                if (!downloadStart) {
                    downloadProgressBar.start(Infinity, 0);
                    downloadStart = true;
                }
                downloadProgressBar.setTotal(totalBytes);
                downloadProgressBar.update(downloadedBytes);
            }
        });
        logger.info("\nInstallation completed");
    }

    return {
        executablePath
    };

}

// 浏览器计数
let browserIndex = 1;

/**
 * 浏览器
 */
class Browser {

    /** 浏览器状态枚举 */
    static STATE = {
        /** 未初始化 */
        UNINITIALIZED: Symbol("UNINITIALIZED"),
        /** 已就绪 */
        READY: Symbol("READY"),
        /** 不可用 */
        UNAVAILABLED: Symbol("UNAVAILABLED"),
        /** 已关闭 */
        CLOSED: Symbol("CLOSED")
    };

    /**
     * @typedef {Object} PageOptions
     * @property {number} [width] - 页面视窗宽度
     * @property {number} [height] - 页面视窗高度
     * @property {string} [userAgent] - 用户UA
     * @property {number} [beginFrameTimeout=5000] - BeginFrame超时时间（毫秒）
     * @property {string} [frameFormat="jpeg"] - 帧图格式
     * @property {number} [frameQuality=80] - 帧图质量（0-100）
     */

    /** @type {string} - 浏览器ID */
    id = `Browser@${browserIndex++}`;
    /** @type {Browser.STATE} - 浏览器状态 */
    state = Browser.STATE.UNINITIALIZED;
    /** @type {Pool} - 浏览器池 */
    parent = null;
    /** @type {_Pool} - 浏览器页面资源池 */
    #pagePool;
    /** @type {_Browser} - 浏览器实例 */
    target = null;
    /** @type {number} - 页面资源最大数量 */
    numPageMax;
    /** @type {number} - 页面资源最小数量 */
    numPageMin;
    /** @type {string} - 浏览器入口文件路径 */
    executablePath;
    /** @type {boolean=true} - 是否使用GPU加速渲染 */
    useGPU;
    /** @type {boolean=true} - 3D渲染后端是否使用Angle，建议开启 */
    useAngle;
    /** @type {boolean=false} - 是否禁用共享内存，当/dev/shm较小时建议开启此选项 */
    disableDevShm;
    /** @type {string[]} - 浏览器启动参数 */
    args = [];
    /** @type {PageOptions} - 浏览器日志是否输出到控制台 */
    pageOptions = {};
    /** @type {boolean} - 浏览器是否已关闭 */
    closed = false;
    /** @type {Function[]} - 启动回调队列 */
    #launchCallbacks = [];
    /** @type {boolean} - 是否初始页面 */
    #firstPage = true;
    /** @type {AsyncLock} - 异步锁 */
    #asyncLock = new AsyncLock();

    /**
     * 构造函数
     * 
     * @param {Pool} parent - 浏览器资源池
     * @param {Object} options - 浏览器选项
     * @param {number} [options.numPageMax=5] - 页面资源最大数量
     * @param {number} [options.numPageMin=1] - 页面资源最小数量
     * @param {string} [options.executablePath] - 浏览器入口文件路径
     * @param {boolean} [options.useGPU=true] - 是否使用GPU加速渲染，建议开启
     * @param {boolean} [options.useAngle=true] - 渲染后端是否使用Angle，建议开启
     * @param {boolean} [options.disableDevShm=false] - 是否禁用共享内存，当/dev/shm较小时建议开启此选项
     * @param {string[]} [options.args] - 浏览器启动参数
     * @param {PageOptions} [options.pageOptions] - 页面选项
     */
    constructor(parent, options = {}) {
        assert(parent instanceof ResourcePool, "Browser parent must be Pool");
        this.parent = parent;
        assert(_.isObject(options), "Browser options must be object");
        const { numPageMax, numPageMin, executablePath, useGPU, useAngle, disableDevShm, args, pageOptions } = options;
        assert(_.isUndefined(numPageMax) || _.isFinite(numPageMax), "Browser numPageMax must be number");
        assert(_.isUndefined(numPageMin) || _.isFinite(numPageMin), "Browser numPageMin must be number");
        assert(_.isUndefined(executablePath) || _.isBoolean(executablePath), "Browser executablePath must be string");
        assert(_.isUndefined(useGPU) || _.isBoolean(useGPU), "Browser useGPU must be boolean");
        assert(_.isUndefined(useAngle) || _.isBoolean(useAngle), "Browser useAngle must be boolean");
        assert(_.isUndefined(disableDevShm) || _.isBoolean(disableDevShm), "Browser disableDevShm must be boolean");
        assert(_.isUndefined(args) || _.isArray(args), "Browser args must be array");
        assert(_.isUndefined(pageOptions) || _.isObject(pageOptions), "Browser pageOptions must be object");
        this.numPageMax = _.defaultTo(numPageMax, _.defaultTo(globalConfig.numPageMax, 5));
        this.numPageMin = _.defaultTo(numPageMin, _.defaultTo(globalConfig.numPageMin, 1));
        this.executablePath = _.defaultTo(executablePath, _.defaultTo(globalConfig.browserExecutablePath, null));
        this.useGPU = _.defaultTo(useGPU, _.defaultTo(globalConfig.browserUseGPU, true));
        this.useAngle = _.defaultTo(useAngle, _.defaultTo(globalConfig.browserUseAngle, true));
        this.disableDevShm = _.defaultTo(disableDevShm, _.defaultTo(globalConfig.browserDisableDevShm, false));
        this.args = _.defaultTo(args, []);
        this.pageOptions = _.defaultTo(pageOptions, {});
    }

    /**
     * 浏览器资源初始化
     */
    async init() {
        await this.#asyncLock.acquire("init", async () => {
            let executablePath;
            if (_.isString(this.executablePath))
                executablePath = this.executablePath;
            else
                ({ executablePath } = await installBrowser());
            // 启动浏览器
            this.target = await puppeteer.launch({
                // BeginFrameControl必需处于无头模式下可用，新无头"new"暂时不可用，请关注进展：https://bugs.chromium.org/p/chromium/issues/detail?id=1480747
                headless: _.defaultTo(globalConfig.browserHeadless, true),
                // 浏览器入口文件路径
                executablePath,
                // 忽略HTTPS错误
                ignoreHTTPSErrors: true,
                // 浏览器启动超时时间（毫秒）
                timeout: _.defaultTo(globalConfig.browserLaunchTimeout, 30000),
                // 是否输出调试信息到控制台
                dumpio: _.defaultTo(globalConfig.browserDebug, false),
                // 是否使用管道通信
                pipe: false,
                // 协议超时时间（毫秒）
                protocolTimeout: _.defaultTo(globalConfig.browserProtocolTimeout, 180000),
                // 用户目录路径
                userDataDir: "tmp/browser",
                // 浏览器启动参数
                args: this.#generateArgs()
            });
            // 浏览器关闭时自动处理
            this.target.once("disconnected", () => {
                this.close()
                    .catch(err => logger.error(`Browser ${this.id} close error:`, err));
            });
            // 创建页面池
            this.#createPagePool();
            // 预热页面池
            await this.#warmupPagePool();
            // 启动回调
            this.#launchCallbacks.forEach(fn => fn());
            // 设置浏览器状态为已就绪
            this.#setState(Browser.STATE.READY);
        });
    }

    /**
     * 创建页面池
     */
    #createPagePool() {
        this.#pagePool = genericPool.createPool({
            create: this.#createPage.bind(this),
            destroy: target => target.close(),
            validate: target => target.isReady()
        }, {
            max: this.numPageMax,
            min: this.numPageMin,
            autostart: false
        });
        this.#pagePool.on('factoryCreateError', (error) => {
            const client = this.#pagePool._waitingClientsQueue.dequeue();
            if (!client) return logger.error(error);
            client.reject(error);
        });
    }

    /**
     * 预热页面池
     */
    async #warmupPagePool() {
        this.#pagePool.start();
        await this.#pagePool.ready();
    }

    /**
     * 获取可用页面资源
     * 
     * @returns {Page} - 页面资源
     */
    async acquirePage() {
        return await this.#pagePool.acquire();
    }

    /**
     * 创建页面资源
     * 
     * @returns {Page} - 页面资源
     */
    async #createPage() {
        if (!this.target)
            await new Promise(resolve => this.#launchCallbacks.push(resolve));
        const page = new Page(this, { ...this.pageOptions, _firstPage: this.firstPage });
        await page.init();
        return page;
    }

    /**
     * 释放页面资源
     * 
     * @param {Page} page - 页面资源
     */
    async releasePage(page) {
        await this.#pagePool.release(page);
    }

    /**
     * 销毁页面资源
     * 
     * @param {Page} page - 页面资源
     */
    async destoryPage(page) {
        await this.#pagePool.destroy(page);
    }

    /**
     * 释放浏览器资源
     */
    async release() {
        await this.#asyncLock.acquire("release", async () => {
            // 通知浏览器资源池释放资源
            await this.parent.releaseBrowser(this);
            // 设置浏览器状态为已就绪
            this.#setState(Browser.STATE.READY);
        });
    }

    /**
     * 关闭浏览器
     */
    async close() {
        await this.#asyncLock.acquire("close", async () => {
            if (this.isClosed())
                return;
            // 设置浏览器状态为已关闭
            this.#setState(Browser.STATE.CLOSED);
            // 清除页面池资源
            await this.#pagePool.clear();
            // 通知浏览器资源池销毁资源
            await this.parent.destoryBrowser(this);
            // 如果浏览器已关闭则跳过
            if (!this.target || this.target.isClosed())
                return;
            this.target.close();
            this.target = null;
        });
    }

    /**
     * 获取浏览器页面数量
     * 
     * @returns {number} - 页面数量
     */
    async getPageCount() {
        return (await this.target.pages()).length;
    }

    /**
     * 生成浏览器启动参数
     * 
     * @returns {Array} - 参数列表
     */
    #generateArgs() {
        return [
            // 禁用沙箱
            "--no-sandbox",
            // 禁用UID沙箱
            "--disable-setuid-sandbox",
            // Windows下--single-process支持存在问题
            util.isLinux() ? "--single-process" : "--process-per-tab",
            // 如果共享内存/dev/shm比较小，可能导致浏览器无法启动，可以禁用它
            ...(this.disableDevShm ? ["--disable-dev-shm-usage"] : []),
            // 禁用扩展程序
            "--disable-extensions",
            // 隐藏滚动条
            "--hide-scrollbars",
            // 静音
            "--mute-audio",
            // 禁用Web安全策略
            "--disable-web-security",
            // 禁用小恐龙彩蛋
            "--disable-dinosaur-easter-egg",
            // 禁用IPC泛洪保护
            "--disable-ipc-flooding-protection",
            // 禁用降低后台标签页优先级
            "--disable-backgrounding-occluded-windows",
            // 禁用后台标签页定时器节流
            "--disable-background-timer-throttling",
            // 禁用渲染器进程后台化
            "--disable-renderer-backgrounding",
            // 禁用组件更新
            "--disable-component-update",
            // 禁用崩溃报告系统
            "--disable-breakpad",
            // 禁用ping元素
            "--no-pings",
            // 禁用信息栏
            "--disable-infobars",
            // 禁用会话崩溃气泡
            "--disable-session-crashed-bubble",
            // 禁用字形提示以原始轮廓渲染
            "--font-render-hinting=none",
            // 允许在HTTPS页面中加载不安全的HTTP内容
            "--allow-running-insecure-content",
            // 禁用默认浏览器检查
            "--no-default-browser-check",
            // 禁用弹窗
            "--block-new-web-contents",
            // 禁用错误对话框
            "--noerrdialogs",
            // 启用平滑滚动
            "--enable-smooth-scrolling",
            // 禁用线程动画避免动画不同步
            "--disable-threaded-animation",
            // 禁用线程滚动避免动画不同步
            "--disable-threaded-scrolling",
            // 启用表面同步
            "--enable-surface-synchronization",
            // 强制所有内容完整渲染
            "--disable-new-content-rendering-timeout",
            // 禁用渲染器代码完整性，避免因为STATUS_ACCESS_VIOLATION导致页面崩溃
            "--disable-features=RendererCodeIntegrity",
            ...(!globalConfig.browserFrameRateLimit ? [
                // 解除帧率限制
                "--disable-frame-rate-limit",
            ] : []),
            ...(!globalConfig.compatibleRenderingMode ? [
                // 启用确定性模式
                "--deterministic-mode",
                // 开启beginFrame控制
                "--enable-begin-frame-control",
                // 在呈现所有内容之前防止绘制下一帧
                "--run-all-compositor-stages-before-draw",
            ] : []),
            // 是否使用Angle作为渲染后端
            ...(this.useAngle ? ["--use-angle"] : []),
            // 是否使用GPU加速渲染
            ...(this.useGPU ? [
                // 启用GPU
                "--enable-gpu",
                // 启用不安全的WebGPU
                "--enable-unsafe-webgpu",
                // 忽略GPU黑名单，在黑名单的GPU渲染时可能会发生非预期效果
                "--ignore-gpu-blocklist",
                // 图形上下文丢失时不重载页面
                "--gpu-no-context-lost",
                // 启用GPU合成功能
                "--enable-gpu-compositing",
                // 启用GPU栅格化加速绘制
                "--enable-gpu-rasterization",
                // 禁用GPU驱动程序错误处理工作
                // "--disable-gpu-driver-bug-workarounds",
                // 启用GPU内存缓冲区提高图像处理性能
                "--enable-native-gpu-memory-buffers",
                // 启用2D画布加速功能
                "--enable-accelerated-2d-canvas",
                // 启用JPEG解码加速功能
                "--enable-accelerated-jpeg-decoding",
                // 启用MJPEG解码加速功能
                "--enable-accelerated-mjpeg-decode",
                // 启用视频解码加速功能
                "--enable-accelerated-video-decode",
                // 启用零拷贝渲染
                "--enable-zero-copy",
                // 将页面渲染栅格化操作移动到单独的进程中执行
                "--enable-oop-rasterization",
                // 启用GPU内存缓冲区缓存视频帧
                "--enable-gpu-memory-buffer-video-frames",
                // 启用VA-API视频解码器支持、原始绘制支持、Canvas独立进程栅格化、HEVC视频解码器支持
                "--enable-features=VaapiVideoDecoder,RawDraw,CanvasOopRasterization,PlatformHEVCDecoderSupport"
            ] : ["--disable-gpu"]),
            // 其它参数
            ...this.args
        ];
    }

    /**
     * 设置浏览器资源状态
     * 
     * @param {Browser.STATE} state - 浏览器资源状态
     */
    #setState(state) {
        assert(_.isSymbol(state), "state must be Symbol");
        this.state = state;
    }

    /**
     * 是否未初始化
     * 
     * @returns {boolean} - 是否未初始化
     */
    isUninitialized() {
        return this.state == Browser.STATE.UNINITIALIZED;
    }

    /**
     * 是否已就绪
     * 
     * @returns {boolean} - 是否已就绪
     */
    isReady() {
        return this.state == Browser.STATE.READY;
    }

    /**
     * 是否不可用
     * 
     * @returns {boolean} - 是否不可用
     */
    isUnavailabled() {
        return this.state == Browser.STATE.UNAVAILABLED;
    }

    /**
     * 是否已关闭
     * 
     * @returns {boolean} - 是否已关闭
     */
    isClosed() {
        return this.state == Browser.STATE.CLOSED;
    }

    /**
     * 判断页面资源池是否饱和
     * 
     * @returns {boolean} 页面池是否饱和
     */
    isBusy() {
        return this.#pagePool.borrowed >= this.#pagePool.max;
    }

    /**
     * 获取是否首个页面
     * 
     * @returns {boolean} 是否首个页面
     */
    get firstPage() {
        if (!this.#firstPage)
            return false;
        this.#firstPage = false;
        return true;
    }

    /**
     * 获取视频预处理器
     */
    get videoPreprocessor() {
        return this.parent.videoPreprocessor;
    }

}

// 异步锁
const asyncLock = new AsyncLock();

/**
 * 资源池
 */
class ResourcePool {

    /**
     * @typedef {Object} PageOptions
     * @property {number} [width] - 页面视窗宽度
     * @property {number} [height] - 页面视窗高度
     * @property {string} [userAgent] - 用户UA
     * @property {number} [beginFrameTimeout=5000] - BeginFrame超时时间（毫秒）
     * @property {string} [frameFormat="jpeg"] - 帧图格式
     * @property {number} [frameQuality=80] - 帧图质量（0-100）
     */

    /**
     * @typedef {Object} BrowserOptions
     * @property {number} numPageMax - 页面资源最大数量
     * @property {number} numPageMin - 页面资源最小数量
     * @property {string} [executablePath] - 浏览器可执行文件路径
     * @property {boolean} [useGPU=true] - 是否使用GPU加速渲染
     * @property {boolean} [useAngle=true] - 3D渲染后端是否使用Angle，建议开启
     * @property {boolean} [disableDevShm=false] - 是否禁用共享内存，当/dev/shm较小时建议开启此选项
     * @property {string[]} [args] - 浏览器启动参数
     * @property {boolean} [debug=false] - 浏览器日志是否输出到控制台
     * @property {PageOptions} [pageOptions] - 页面选项
     */

    /**
     * @typedef {Object} VideoPreprocessorOptions
     * @property {number} [parallelDownloads=10] - 并行下载数量
     * @property {number} [parallelProcess=10] - 并行处理数量
     * @property {string} [videoEncoder="libx264"] - 视频编码器（必须为H264编码器）
     */

    /** @type {_Pool} - 浏览器资源池 */
    #browserPool;
    /** @type {VideoPreprocessor} - 视频预处理器 */
    #videoPreprocessor;
    /** @type {number} - 浏览器资源最大数量 */
    numBrowserMax;
    /** @type {number} - 浏览器资源最小数量 */
    numBrowserMin;
    /** @type {BrowserOptions} - 浏览器选项 */
    browserOptions = {};
    /** @type {VideoPreprocessorOptions} - 浏览器选项 */
    videoPreprocessorOptions = {};
    #warmupped = false;
    #checkMap = {};

    /**
     * 构造函数
     * 
     * @param {Object} options - 资源池选项
     * @param {number} [options.numBrowserMax=5] - 浏览器资源最大数量
     * @param {number} [options.numBrowserMin=1] - 浏览器资源最小数量
     * @param {BrowserOptions} [options.browserOptions={}] - 浏览器选项
     * @param {VideoPreprocessorOptions} [options.videoPreprocessorOptions={}] - 视频预处理器选项
     */
    constructor(options = {}) {
        assert(_.isObject(options), "ResourcePool options must provided");
        const { numBrowserMax, numBrowserMin, browserOptions, videoPreprocessorOptions } = options;
        assert(_.isUndefined(numBrowserMax) || _.isFinite(numBrowserMax), "ResourcePool options.numBrowserMax must be number");
        assert(_.isUndefined(numBrowserMin) || _.isFinite(numBrowserMin), "ResourcePool options.numBrowserMin must be number");
        assert(_.isUndefined(browserOptions) || _.isObject(browserOptions), "ResourcePool options.browserOptions must be object");
        assert(_.isUndefined(videoPreprocessorOptions) || _.isObject(videoPreprocessorOptions), "ResourcePool options.browserOptions must be object");
        this.numBrowserMax = _.defaultTo(numBrowserMax, _.defaultTo(globalConfig.numBrowserMax, 5));
        this.numBrowserMin = _.defaultTo(numBrowserMin, _.defaultTo(globalConfig.numBrowserMin, 1));
        this.browserOptions = _.defaultTo(browserOptions, {});
        this.videoPreprocessorOptions = _.defaultTo(videoPreprocessorOptions, {});
        this.#videoPreprocessor = new VideoPreprocessor(this.videoPreprocessorOptions);
        this.#createBrowserPool();
        this.#checker();
    }

    /**
     * 预热浏览器资源池
     */
    async warmup() {
        if(this.#warmupped) return;
        await asyncLock.acquire("warmup", async () => {
            this.#browserPool.start();
            await this.#browserPool.ready();
            this.#warmupped = true;
        });
    }

    /**
     * 创建浏览器资源池
     */
    #createBrowserPool() {
        this.#browserPool = genericPool.createPool({
            create: this.#createBrowser.bind(this),
            destroy: async target => target.close(),
            validate: target => target.isReady()
        }, {
            max: this.numBrowserMax,
            min: this.numBrowserMin,
            autostart: false
        });
        this.#browserPool.on('factoryCreateError', (error) => {
            const client = this.#browserPool._waitingClientsQueue.dequeue();
            if(!client) return logger.error(error);
            client.reject(error);
        });
    }

    /**
     * 获取可用页面资源
     * 
     * @returns {Page}
     */
    async acquirePage() {
        // 使用异步锁解决重入
        return await asyncLock.acquire("acquirePage", async () => {
            // 获取可用的浏览器资源
            const browser = await this.acquireBrowser();
            // 从浏览器获取可用的页面资源
            const page = await browser.acquirePage();
            // 如果浏览器页面池未饱和则释放浏览器资源供下一次获取
            if (!browser.isBusy())
                await browser.release();
            // 如果已饱和加入检查列表等待未饱和时释放浏览器资源
            else if (!this.#checkMap[browser.id]) {
                this.#checkMap[browser.id] = () => {
                    if (!browser.isBusy()) {
                        browser.release();
                        return true;
                    }
                    return false;
                };
            }
            // 返回可用页面资源
            return page;
        });
    }

    /**
     * 获取可用浏览器资源
     * 
     * @returns {Browser}
     */
    async acquireBrowser() {
        !this.#warmupped && await this.warmup();
        return await this.#browserPool.acquire();
    }

    /**
     * 创建浏览器资源
     * 
     * @returns {Browser} - 浏览器资源
     */
    async #createBrowser() {
        const browser = new Browser(this, this.browserOptions);
        await browser.init();
        return browser;
    }

    /**
     * 释放浏览器资源
     * 
     * @param {Browser} browser - 浏览器资源
     */
    async releaseBrowser(browser) {
        await this.#browserPool.release(browser);
    }

    /**
     * 销毁浏览器资源
     * 
     * @param {Browser} browser - 浏览器资源
     */
    async destoryBrowser(browser) {
        if (this.#checkMap[browser.id])
            delete this.#checkMap[browser.id];
        await this.#browserPool.destroy(browser);
    }

    /**
     * 判断浏览器资源池是否饱和
     * 
     * @returns {boolean} 浏览器池是否饱和
     */
    isBusy() {
        return this.#browserPool.borrowed >= this.#browserPool.max;
    }

    /**
     * 检查器
     */
    #checker() {
        (async () => {
            for (let id in this.#checkMap) {
                if (this.#checkMap[id]())
                    delete this.#checkMap[id];
            }
        })()
            .then(() => setTimeout(this.#checker.bind(this), 5000))
            .catch(err => logger.error(err));
    }

    /**
     * 获取视频预处理器
     */
    get videoPreprocessor() {
        return this.#videoPreprocessor;
    }

}

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

/** @typedef {import('fluent-ffmpeg').FfmpegCommand} FfmpegCommand */

/**
 * 序列帧合成器
 */
class Synthesizer extends EventEmitter {

    /** 合成器状态枚举 */
    static STATE = {
        /** 已就绪 */
        READY: Symbol("READY"),
        /** 合成中 */
        SYNTHESIZING: Symbol("SYNTHESIZING"),
        /** 已完成 */
        COMPLETED: Symbol("COMPLETED")
    };

    /** @type {string} - 合成器ID */
    id = uniqid("video_");
    /** @type {Synthesizer.STATE} - 合成器状态 */
    state = Synthesizer.STATE.READY;
    /** @type {number} - 合成进度 */
    progress = 0;
    /** 合成对象名称 */
    name = null;
    /** @type {string} - 导出视频路径 */
    outputPath;
    /** @type {number} - 视频合成帧率 */
    fps;
    /** @type {number} - 视频宽度 */
    width;
    /** @type {number} - 视频高度 */
    height;
    /** @type {number} - 视频时长 */
    duration;
    /** @type {string} - 视频格式（mp4/webm） */
    format;
    /** @type {string} - 附加到视频首帧的封面路径 */
    attachCoverPath;
    /** @type {boolean} - 是否捕获封面并输出*/
    coverCapture;
    /** @type {number} - 封面捕获时间点（毫秒）*/
    coverCaptureTime;
    /** @type {string} - 封面捕获格式（jpg/png/bmp） */
    coverCaptureFormat;
    /** @type {string} - 视频编码器 */
    videoEncoder;
    /** @type {number} - 视频质量（0-100） */
    videoQuality;
    /** @type {string} - 视频码率（如8M，设置码率将忽略videoQuality） */
    videoBitrate;
    /** @type {string} - 像素格式（yuv420p/yuv444p/rgb24） */
    pixelFormat;
    /** @type {string} - 音频编码器（aac/ogg） */
    audioEncoder;
    /** @type {string} - 音频码率 */
    audioBitrate;
    /** @type {numer} - 视频音量（0-100） */
    volume;
    /** @type {numer} - 并行写入帧数 */
    parallelWriteFrames;
    /** @type {boolean} - 背景不透明度（0-1）仅webm格式支持 */
    backgroundOpacity;
    /** @type {boolean} - 是否在命令行展示进度 */
    showProgress;
    /** @type {Audio[]} - 音频列表 */
    audios = [];
    /** @type {string} - 临时路径 */
    tmpDirPath = path.resolve("tmp/synthesizer/");
    /** @type {number} - 启动时间点 */
    _startupTime = null;
    /** @protected @type {string} - 交换文件路径 */
    _swapFilePath;
    /** @type {number} - 帧计数 */
    _frameCount = 0;
    /** @protected @type {cliProgress.SingleBar|cliProgress.MultiBar} - cli进度 */
    _cliProgress = null;
    /** @protected @type {number} - 目标帧数 */
    _targetFrameCount = 0;
    /** @type {Buffer[]} - 帧缓冲区列表 */
    #frameBuffers = null;
    /** @type {Buffer[]} - 帧缓冲区指针 */
    #frameBufferIndex = 0;
    /** @type {PassThrough} - 帧写入管道流 */
    #pipeStream = null;
    /** @type {FfmpegCommand} - 当前编码器 */
    #encoder = null;

    /**
     * 构造函数
     * 
     * @param {Object} options - 序列帧合成器选项
     * @param {string} options.outputPath - 导出视频路径
     * @param {number} options.width - 视频宽度
     * @param {number} options.height - 视频高度
     * @param {number} options.duration - 视频时长
     * @param {number} [options.fps=30] - 视频合成帧率
     * @param {string} [options.format] - 导出视频格式（mp4/webm）
     * @param {string} [options.attachCoverPath] - 附加到视频首帧的封面路径
     * @param {string} [options.coverCapture=false] - 是否捕获封面并输出
     * @param {number} [options.coverCaptureTime] - 封面捕获时间点（毫秒）
     * @param {string} [options.coverCaptureFormat="jpg"] - 封面捕获格式（jpg/png/bmp）
     * @param {string} [options.videoEncoder="libx264"] - 视频编码器
     * @param {number} [options.videoQuality=100] - 视频质量（0-100）
     * @param {string} [options.videoBitrate] - 视频码率（设置码率将忽略videoQuality）
     * @param {string} [options.pixelFormat="yuv420p"] - 像素格式（yuv420p/yuv444p/rgb24）
     * @param {string} [options.audioEncoder="aac"] - 音频编码器
     * @param {string} [options.audioBitrate] - 音频码率
     * @param {number} [options.volume=100] - 视频音量（0-100）
     * @param {number} [options.parallelWriteFrames=10] - 并行写入帧数
     * @param {boolean} [options.backgroundOpacity=1] - 背景不透明度（0-1），仅webm格式支持
     * @param {boolean} [options.showProgress=false] - 是否在命令行展示进度
     */
    constructor(options) {
        super();
        assert(_.isObject(options), "Synthesizer options must be object");
        const { width, height, fps, duration, format, outputPath,
            attachCoverPath, coverCapture, coverCaptureTime, coverCaptureFormat,
            videoEncoder, videoQuality, videoBitrate, pixelFormat, audioEncoder,
            audioBitrate, volume, parallelWriteFrames, backgroundOpacity, showProgress } = options;
        assert(_.isFinite(width) && width % 2 === 0, "width must be even number");
        assert(_.isFinite(height) && height % 2 === 0, "height must be even number");
        assert(_.isFinite(duration), "synthesis duration must be number");
        assert(_.isString(outputPath) || this._isVideoChunk(), "outputPath must be string");
        assert(_.isUndefined(fps) || _.isFinite(fps), "synthesis fps must be number");
        assert(_.isUndefined(format) || SUPPORT_FORMAT.includes(format), `format ${format} is not supported`);
        assert(_.isUndefined(attachCoverPath) || _.isString(attachCoverPath), "attachCoverPath must be string");
        assert(_.isUndefined(coverCapture) || _.isBoolean(coverCapture), "coverCapture must be boolean");
        assert(_.isUndefined(coverCaptureTime) || _.isFinite(coverCaptureTime), "coverCaptureTime must be number");
        assert(_.isUndefined(coverCaptureFormat) || _.isString(coverCaptureFormat), "coverCaptureFormat must be string");
        assert(_.isUndefined(videoEncoder) || _.isString(videoEncoder), "videoEncoder must be string");
        assert(_.isUndefined(videoQuality) || _.isFinite(videoQuality), "videoQuality must be number");
        assert(_.isUndefined(videoBitrate) || _.isString(videoBitrate), "videoBitrate must be string");
        assert(_.isUndefined(pixelFormat) || _.isString(pixelFormat), "pixelFormat must be string");
        assert(_.isUndefined(audioEncoder) || _.isString(audioEncoder), "audioEncoder must be string");
        assert(_.isUndefined(audioBitrate) || _.isString(audioBitrate), "audioBitrate must be string");
        assert(_.isUndefined(volume) || _.isFinite(volume), "volume must be number");
        assert(_.isUndefined(parallelWriteFrames) || _.isFinite(parallelWriteFrames), "parallelWriteFrames must be number");
        assert(_.isUndefined(backgroundOpacity) || _.isFinite(backgroundOpacity), "backgroundOpacity must be number");
        assert(_.isUndefined(showProgress) || _.isBoolean(showProgress), "showProgress must be boolean");
        if (!format && outputPath && !this._isVideoChunk()) {
            const _format = path.extname(outputPath).substring(1);
            if (!_format)
                throw new Error(`Unable to recognize output video format: ${outputPath}`);
            if (!SUPPORT_FORMAT.includes(_format))
                throw new Error(`Unsupported output video format: ${_format}`);
            this.format = _format;
        }
        else if (format)
            this.format = format;
        else
            this.format = SUPPORT_FORMAT[0];
        this.width = width;
        this.height = height;
        this.fps = _.defaultTo(fps, 30);
        this.duration = duration;
        this.outputPath = _.isString(outputPath) ? path.resolve(outputPath) : outputPath;
        this.name = this.outputPath ? path.basename(this.outputPath) : null;
        this.attachCoverPath = _.isString(attachCoverPath) ? path.resolve(attachCoverPath) : attachCoverPath;
        this.coverCapture = _.defaultTo(coverCapture, false);
        this.coverCaptureTime = coverCaptureTime;
        this.coverCaptureFormat = _.defaultTo(coverCaptureFormat, "jpg");
        this.videoEncoder = _.defaultTo(videoEncoder, _.defaultTo(this.format == "webm" ? globalConfig.webmEncoder : globalConfig.mp4Encoder, FORMAT_VIDEO_ENCODER_MAP[this.format][0] || "libx264"));
        this.videoQuality = _.defaultTo(videoQuality, 100);
        this.videoBitrate = videoBitrate;
        this.audioEncoder = _.defaultTo(audioEncoder, _.defaultTo(globalConfig.audioEncoder, FORMAT_AUDIO_ENCODER_MAP[this.format][0] || "aac"));
        this.audioBitrate = audioBitrate;
        this.volume = _.defaultTo(volume, 100);
        this.parallelWriteFrames = _.defaultTo(parallelWriteFrames, 10);
        this.backgroundOpacity = _.defaultTo(backgroundOpacity, 1);
        this.pixelFormat = _.defaultTo(pixelFormat, this.hasAlphaChannel ? "yuva420p" : "yuv420p");
        this.showProgress = _.defaultTo(showProgress, false);
        this.#frameBuffers = new Array(this.parallelWriteFrames);
        this._swapFilePath = path.join(this.tmpDirPath, `${uniqid("video_")}.${this.format}`);
        this._targetFrameCount = util.durationToFrameCount(this.duration, this.fps);
        if (this.showProgress) {
            this._cliProgress = new cliProgress.SingleBar({
                hideCursor: true,
                format: `[${"{bar}".green}] {percentage}% | {value}/{total} | {eta_formatted} | {filename}`,
            }, cliProgress.Presets.shades_grey);
        }
    }

    /**
     * 启动合成
     */
    start() {
        if (!this.#pipeStream)
            this.#pipeStream = new stream.PassThrough();
        assert(this.isReady(), "Synthesizer status is not READY, please reset the synthesizer: synthesizer.reset()");
        this.#setState(Synthesizer.STATE.SYNTHESIZING);
        this._startupTime = _.defaultTo(this._startupTime, performance.now());
        this._targetFrameCount = util.durationToFrameCount(this.duration, this.fps);
        (async () => {
            await fs.ensureDir(path.dirname(this.outputPath));
            await fs.ensureDir(this.tmpDirPath);
            // 等待启动前已添加的音频加载完成
            await this.#waitForAudiosLoaded();
            await new Promise((resolve, reject) => {
                this._createVideoEncoder()
                    .once("start", cmd => util.ffmpegLog(cmd))
                    .on("progress", e => {
                        if (!this._targetFrameCount)
                            return this._emitProgress(0, 0, 0);
                        const progres = e.frames / this._targetFrameCount;
                        this._emitProgress(progres * (this.audioSynthesis ? 98 : 100), e.frames, this._targetFrameCount);
                    })
                    .once("error", reject)
                    .once("end", resolve)
                    .run();
            });
            if (!this._isVideoChunk()) {
                if (this.audioSynthesis) {
                    // 等待渲染期间新添加的音频加载完成
                    await this.#waitForAudiosLoaded();
                    await new Promise((resolve, reject) => {
                        this._createAudioEncoder()
                            .once("start", cmd => util.ffmpegLog(cmd))
                            .on("progress", e => this._emitProgress(98 + ((e.percent || 0) * 0.02), this._targetFrameCount, this._targetFrameCount))
                            .once("error", reject)
                            .once("end", resolve)
                            .run();
                    });
                    await fs.remove(this._swapFilePath);
                }
                else
                    await fs.move(this._swapFilePath, this.outputPath, { overwrite: true });
            }
            this.coverCapture && await this.#captureCover();
            this.#setState(Synthesizer.STATE.COMPLETED);
            this._emitCompleted();
        })()
            .catch(err => this._emitError(err));
    }

    /**
     * 终止合成
     */
    abort() {
        this.#drain();
        this.#closeEncoder(true);
    }

    /**
     * 输入帧
     * 
     * @param {Buffer} buffer - 帧缓冲区
     */
    input(buffer) {
        if (!this.#pipeStream)
            this.#pipeStream = new stream.PassThrough();
        this.#frameBuffers[this.#frameBufferIndex] = buffer;
        this._frameCount++;
        if (++this.#frameBufferIndex < this.parallelWriteFrames)
            return;
        this.#pipeStream.write(Buffer.concat(this.#frameBuffers));
        this.#frameBufferIndex = 0;
    }

    /**
     * 结束帧输入
     */
    endInput() {
        this.#drain();
        this.#closeEncoder();
    }

    /**
     * 等待音频加载完成
     */
    async #waitForAudiosLoaded() {
        await Promise.all(this.audios.map(audio => audio.load()));
    }

    /**
     * 将缓冲区剩余帧写入管道
     */
    #drain() {
        if (!this.#pipeStream)
            return;
        if (this.#frameBufferIndex > 0)
            this.#pipeStream.write(Buffer.concat(this.#frameBuffers.filter(v => v)));
        this.#frameBufferIndex = 0;
        if (!this.#pipeStream.closed)
            this.#pipeStream.end();
        this.#pipeStream = null;
    }

    /**
     * 发送进度事件
     * 
     * @protected
     * @param {number} value - 进度值
     */
    _emitProgress(value) {
        if (value > 100)
            value = 100;
        this.progress = Math.floor(value * 1000) / 1000;
        if (this._cliProgress) {
            if (!this._cliProgress.started) {
                if (this._cliProgress instanceof cliProgress.MultiBar)
                    this._cliProgress = this._cliProgress.create(this._targetFrameCount, 0);
                else
                    this._cliProgress.start(this._targetFrameCount, 0);
                this._cliProgress.started = true;
            }
            this._cliProgress.update(this._frameCount, { filename: this.name });
        }
        this.emit("progress", this.progress, this._frameCount, this._targetFrameCount);
    }

    /**
     * 发送已完成事件
     * 
     * @protected
     */
    _emitCompleted() {
        this._emitProgress(100);
        if (this._cliProgress) {
            this._cliProgress.stop();
            this._cliProgress = null;
        }
        const takes = performance.now() - this._startupTime;
        this._startupTime = null;
        const outputDuration = this.getOutputDuration();
        const result = {
            takes,
            duration: outputDuration,
            outputPath: this.outputPath,
            rtf: outputDuration / takes
        };
        this.emit("completed", result);
    }

    /**
     * 发送错误事件
     * 
     * @protected
     * @param {Error} err - 错误对象
     */
    _emitError(err) {
        if (_.isString(err))
            err = new Error(err);
        const message = err.message;
        if (message.indexOf("Error while opening encoder for output stream") != -1 || message.indexOf("ffmpeg exited with code 3221225477") != -1)
            err = new Error(`Video codec ${this.videoEncoder} may not be supported, please check if your hardware supports it: https://github.com/Vinlic/WebVideoCreator/blob/master/docs/video-encoder.md. Some hardware encoders may have limitations in parallel encoding (such as NVENC https://github.com/keylase/nvidia-patch)`);
        if (this._cliProgress) {
            this._cliProgress.stop();
            this._cliProgress = null;
        }
        if (this.eventNames().includes("error"))
            this.emit("error", err);
        else
            logger.error(err);
    }

    /**
     * 添加音频
     * 
     * @param {Audio} audio - 音频对象
     */
    addAudio(audio) {
        if (!(audio instanceof Audio))
            audio = new Audio(audio);
        // 开始加载音频
        audio.load()
            .catch(err => this._emitError(err));
        this.audios.push(audio);
        return audio;
    }

    /**
     * 添加多个音频
     * 
     * @param {Audio[]} audios - 音频对象列表
     */
    addAudios(audios) {
        audios.forEach(audio => this.addAudio(audio));
    }

    /**
     * 更新音频
     * 
     * @param {number} audioId - 音频ID
     * @param {Audio} options - 音频选项
     */
    updateAudio(audioId, options) {
        assert(_.isObject(options), "options must be Object");
        const audio = this.audios.find(audio => audio.id === audioId);
        audio && Object.assign(audio, options);
        return audio;
    }

    /**
     * 创建视频编码器
     * 
     * @protected
     * @returns {FfmpegCommand} - 编码器
     */
    _createVideoEncoder() {
        const { outputPath, width, height, fps, format, videoEncoder, videoBitrate,
            videoQuality, pixelFormat, attachCoverPath, _swapFilePath } = this;
        const vencoder = ffmpeg();
        // 设置视频码率将忽略质量设置
        if (videoBitrate)
            vencoder.videoBitrate(videoBitrate);
        else {
            // 计算总像素量
            const pixels = width * height;
            // 根据像素总量设置视频码率
            vencoder.videoBitrate(`${(2560 / 921600 * pixels) * (videoQuality / 100)}k`);
        }
        const encodingType = this.getVideoEncodingType();
        if (encodingType == "H264" || encodingType == "H265") {
            // 使用主要配置
            vencoder.outputOption("-profile:v main");
            // 使用中等预设
            vencoder.outputOption("-preset medium");
        }
        vencoder.addInput(this.#pipeStream);
        if (attachCoverPath) {
            // 附加封面
            vencoder.addInput(attachCoverPath);
            vencoder.complexFilter(`[1:v]scale=${width}:${height}[cover];[0:v][cover]overlay=repeatlast=0,scale=w=${width}:h=${height},format=${pixelFormat}`);
        }
        else {
            vencoder
                // 设置视频宽高
                .setSize(`${width}x${height}`)
                // 设置像素格式
                .outputOption("-pix_fmt", pixelFormat);
        }
        // 保持透明通道
        this.hasAlphaChannel && vencoder.outputOption("-auto-alt-ref 0");
        vencoder
            // 使用图像管道
            .inputFormat("image2pipe")
            // 指定输入帧率
            .inputFPS(fps)
            // 去除冗余信息
            .inputOption("-hide_banner")
            // 指定视频编码器
            .videoCodec(videoEncoder)
            // 将MOOV头移到最前面
            .outputOption("-movflags +faststart")
            // 指定输出格式
            .toFormat(format)
            // 指定输出路径
            .output(this._isVideoChunk() ? outputPath : _swapFilePath);
        this.#encoder = vencoder;
        return vencoder;
    }

    /**
     * 创建音频编码器
     * 
     * @protected
     * @returns {FfmpegCommand} - 编码器
     */
    _createAudioEncoder() {
        const { outputPath, _swapFilePath, format, audioEncoder,
            audioBitrate, volume: videoVolume, audios } = this;
        const aencoder = ffmpeg();
        // 指定音频码率
        audioBitrate && aencoder.audioBitrate(audioBitrate);
        const outputDuration = this.getOutputDuration();
        aencoder
            .addInput(_swapFilePath)
            .videoCodec("copy")
            .setDuration(outputDuration / 1000)
            .audioCodec(audioEncoder)
            .outputOption("-movflags +faststart")
            .toFormat(format)
            .addOutput(outputPath);
        // 生成音频时间轴的复合过滤器参数
        let outputs = "";
        const complexFilter = audios.reduce((result, audio, index) => {
            const { path, url, loop, startTime, endTime = outputDuration, duration, volume, seekStart, seekEnd, fadeInDuration, fadeOutDuration } = audio;
            if (seekEnd && seekEnd - seekStart > duration)
                return result;
            // 添加音频输入
            aencoder.addInput(path || url);
            // 设置裁剪开始时间点
            seekStart && aencoder.addInputOption("-ss", util.millisecondsToHmss(seekStart));  //截取开始时间点
            // 设置裁剪结束时间点
            seekEnd && aencoder.addInputOption("-to", util.millisecondsToHmss(seekEnd));  //截取结束时间点
            // 时长裁剪过滤器
            const cutFilter = `atrim=start=0:end=${(endTime - startTime) / 1000}`;
            // 循环过滤器
            const loopFilter = loop ? ",aloop=loop=-1:size=2e+09" : "";
            // 延迟过滤器
            const delayFilter = `,adelay=${startTime}|${startTime}`;
            // 音量过滤器
            const volumeFilter = `,volume=${Math.floor((volume * videoVolume) * 0.01) / 100}`;
            // 音频淡入过滤器
            const fadeInFilter = fadeInDuration ? `,afade=t=in:st=${startTime / 1000}:d=${fadeInDuration / 1000}` : "";
            // 音频淡出过滤器
            const fadeOutFilter = fadeOutDuration ? `,afade=t=out:st=${((loop ? endTime : (Math.min(endTime, duration) || duration)) - fadeOutDuration) / 1000}:d=${fadeOutDuration / 1000}` : "";
            // 输出标志
            const output = `a${index}`;
            outputs += `[${output}]`;
            return result + `[${1 + index}]${cutFilter}${loopFilter}${delayFilter}${volumeFilter}${fadeInFilter}${fadeOutFilter}[${output}];`;
        }, "");
        // 应用符合过滤器
        complexFilter && aencoder.complexFilter(`${complexFilter}${outputs}amix=inputs=${audios.length}:normalize=0`);
        this.#encoder = aencoder;
        return aencoder;
    }

    /**
     * 捕获封面
     */
    async #captureCover() {
        const { outputPath, coverCaptureTime, coverCaptureFormat } = this;
        assert(["jpg", "png", "bmp"].includes(coverCaptureFormat), "coverCaptureFormat must be jpg or png or bmp");
        let captureTime = 0;
        if (_.isFinite(coverCaptureTime))
            captureTime = Math.min(coverCaptureTime, this.getOutputDuration());
        else
            captureTime = this.getOutputDuration() * 0.2;
        const coverPath = path.join(path.dirname(outputPath), `${path.basename(outputPath)}.${coverCaptureFormat}`);
        await util.captureScreenshot(outputPath, coverPath, captureTime);
    }

    /**
     * 关闭编码器
     * 
     * @param {boolean} abort - 是否强制终止
     */
    #closeEncoder(abort = false) {
        if (!this.#encoder)
            return;
        // 如果为强制终止则移除结束事件
        abort && this.#encoder.removeAllListeners("end");
        // 强制退出
        if (this.#encoder.ffmpegProc)
            this.#encoder.ffmpegProc.stdin.write("q");
        this.#encoder = null;
    }

    /**
     * 获取已合成视频时长
     * 
     * @returns {number} - 已合成视频时长
     */
    getOutputDuration() {
        if (!this.fps || !this._frameCount)
            return this.duration || 0;
        return Math.floor(this._frameCount / this.fps) * 1000;
    }

    /**
     * 移除输出文件
     */
    async removeOutputFile() {
        const { outputPath, coverCaptureFormat } = this;
        const coverPath = path.join(path.dirname(outputPath), `${path.basename(outputPath)}.${coverCaptureFormat}`);
        await fs.remove(outputPath);
        await fs.remove(coverPath);
    }

    /**
     * 重置合成器
     */
    reset() {
        this.#frameBufferIndex = 0;
        this.#frameBuffers = new Array(this.parallelWriteFrames);
        this._frameCount = 0;
        this._startupTime = null;
        this.#closeEncoder(true);
        if (this.#pipeStream && !this.#pipeStream.closed)
            this.#pipeStream.end();
        this.#pipeStream = null;
        this.#setState(Synthesizer.STATE.READY);
    }

    /**
     * 获取当前视频编码器编码类型
     * 
     * @returns {string} - 编码类型
     */
    getVideoEncodingType() {
        const videoEncoder = this.videoEncoder;
        for (let key in VIDEO_ENCODER_MAP) {
            if (VIDEO_ENCODER_MAP[key].includes(videoEncoder))
                return key;
        }
        return null;
    }

    /**
     * 获取当前音频编码器编码类型
     * 
     * @returns {string} - 编码类型
     */
    getAudioEncodingType() {
        const audioEncoder = this.audioEncoder;
        for (let key in AUDIO_ENCODER_MAP) {
            if (AUDIO_ENCODER_MAP[key].includes(audioEncoder))
                return key;
        }
        return null;
    }

    /**
     * 是否已就绪
     * 
     * @returns {boolean} - 是否已就绪
     */
    isReady() {
        return this.state == Synthesizer.STATE.READY;
    }

    /**
     * 是否合成中
     * 
     * @returns {boolean} - 是否合成中
     */
    isSynthesizing() {
        return this.state == Synthesizer.STATE.SYNTHESIZING;
    }

    /**
     * 是否已完成
     * 
     * @returns {boolean} - 是否已完成
     */
    isCompleted() {
        return this.state == Synthesizer.STATE.COMPLETED;
    }

    /**
     * 移除所有监听器
     */
    removeListeners() {
        this.removeAllListeners("completed");
        this.removeAllListeners("progress");
        this.removeAllListeners("error");
    }

    /**
     * 挂载CliProgress
     * 
     * @param {cliProgress.SingleBar} instance - cli进度条
     */
    attachCliProgress(instance) {
        this.showProgress = true;
        this._cliProgress = instance;
    }

    /**
     * 设置合成器状态
     * 
     * @param {Synthesizer.STATE} state - 合成器状态
     */
    #setState(state) {
        assert(_.isSymbol(state), "state must be Symbol");
        this.state = state;
    }

    /**
     * 设置encoder
     */
    set encoder(value) {
        this.#encoder = value;
    }

    /**
     * 获取encoder
     */
    get encoder() {
        return this.#encoder;
    }

    /**
     * 获取管道流
     */
    get pipeStream() {
        return this.#pipeStream;
    }

    /**
     * 获取已处理帧数
     * 
     * @returns {number} - 已处理帧数
     */
    get frameCount() {
        return this._frameCount;
    }

    /**
     * 获取目标总帧数
     * 
     * @returns {number} - 目标总帧数
     */
    get targetFrameCount() {
        return this._targetFrameCount;
    }

    /**
     * 获取是否合成音频
     * 
     * @returns {boolean} - 是否合成音频
     */
    get audioSynthesis() {
        return this.audios.length > 0;
    }

    /**
     * 获取是否具有透明通道
     */
    get hasAlphaChannel() {
        return this.format == "webm" && this.backgroundOpacity < 1;
    }

    /**
     * 判断是否VideoChunk
     * 
     * @protected
     * @returns {boolean} - 是否为VideoChunk
     */
    _isVideoChunk() {
        return false;
    }

}

/**
 * @typedef {import('puppeteer-core').WaitForOptions} WaitForOptions
 * @typedef {import('puppeteer-core').Viewport} Viewport
 */

/**
 * 单幕视频
 */
class SingleVideo extends Synthesizer {

    /** @type {string} - 页面URL */
    url;
    /** @type {string} - 页面内容 */
    content;
    /** @type {number} - 开始捕获时间点 */
    startTime;
    /** @type {Font[]} - 注册的字体列表 */
    fonts = [];
    /** @type {boolean} - 是否自动启动渲染 */
    autostartRender;
    /** @type {boolean} - 是否输出页面控制台日志 */
    consoleLog;
    /** @type {boolean} - 是否输出视频预处理日志 */
    videoPreprocessLog;
    /** @type {Viewport} - 页面视窗参数 */
    pageViewport;
    /** @type {Function} - 页面预处理函数 */
    pagePrepareFn;
    /** @type {{[key: number]: Function}} - 动作序列 */
    timeActions;
    /** @type {Function} - 终止回调函数 */
    #abortCallback = null;
    /** @type {Function} - 页面获取函数 */
    #pageAcquireFn = null;
    /** @type {AsyncLock} - 异步锁 */
    #asyncLock = new AsyncLock();

    /**
     * 构造函数
     * 
     * @param {Object} options - 单幕视频选项
     * @param {string} [options.url] - 页面URL
     * @param {string} [options.content] - 页面内容
     * @param {string} options.outputPath - 输出路径
     * @param {number} options.width - 视频宽度
     * @param {number} options.height - 视频高度
     * @param {number} options.duration - 视频时长
     * @param {number} [options.startTime] - 开始捕获时间点
     * @param {number} [options.fps=30] - 视频帧率
     * @param {string} [options.format] - 导出视频格式（mp4/webm）
     * @param {string} [options.attachCoverPath] - 附加到视频首帧的封面路径
     * @param {string} [options.coverCapture=false] - 是否捕获封面并输出
     * @param {number} [options.coverCaptureTime] - 封面捕获时间点（毫秒）
     * @param {string} [options.coverCaptureFormat="jpg"] - 封面捕获格式（jpg/png/bmp）
     * @param {string} [options.videoEncoder="libx264"] - 视频编码器
     * @param {number} [options.videoQuality=100] - 视频质量（0-100）
     * @param {string} [options.videoBitrate] - 视频码率（设置码率将忽略videoQuality）
     * @param {string} [options.pixelFormat="yuv420p"] - 像素格式（yuv420p/yuv444p/rgb24）
     * @param {string} [options.audioEncoder="aac"] - 音频编码器
     * @param {string} [options.audioBitrate] - 音频码率
     * @param {number} [options.volume] - 视频音量（0-100）
     * @param {number} [options.parallelWriteFrames=10] - 并行写入帧数
     * @param {Viewport} [options.pageViewport] - 页面视窗参数
     * @param {Function} [options.pagePrepareFn] - 页面预处理函数
     * @param {string} [options.videoDecoderHardwareAcceleration] - VideoDecoder硬件加速指示
     * @param {{[key: number]: Function}} [options.timeActions] - 动作序列
     * @param {WaitForOptions} [options.pageWaitForOptions] - 页面等待选项
     * @param {boolean} [options.showProgress=false] - 是否在命令行展示进度
     * @param {boolean} [options.backgroundOpacity=1] - 背景不透明度（0-1），仅webm格式支持
     * @param {boolean} [options.autostartRender=true] - 是否自动启动渲染，如果为false请务必在页面中执行 captureCtx.start()
     * @param {boolean} [options.consoleLog=false] - 是否开启控制台日志输出
     * @param {boolean} [options.videoPreprocessLog=false] - 是否开启视频预处理日志输出
     */
    constructor(options = {}) {
        super(options);
        const { url, content, startTime, autostartRender, consoleLog, videoPreprocessLog, pageWaitForOptions, pageViewport, pagePrepareFn, videoDecoderHardwareAcceleration, timeActions } = options;
        assert(_.isUndefined(url) || util.isURL(url), `url ${url} is not valid URL`);
        assert(_.isUndefined(content) || _.isString(content), "page content must be string");
        assert(!_.isUndefined(url) || !_.isUndefined(content), "page url or content must be provide");
        assert(_.isUndefined(startTime) || _.isFinite(startTime), "startTime must be number");
        assert(_.isUndefined(autostartRender) || _.isBoolean(autostartRender), "autostartRender must be boolean");
        assert(_.isUndefined(consoleLog) || _.isBoolean(consoleLog), "consoleLog must be boolean");
        assert(_.isUndefined(pageWaitForOptions) || _.isObject(pageWaitForOptions), "pageWaitForOptions must be Object");
        assert(_.isUndefined(pageViewport) || _.isObject(pageViewport), "pageViewport must be Object");
        assert(_.isUndefined(pagePrepareFn) || _.isFunction(pagePrepareFn), "pagePrepareFn must be Function");
        assert(_.isUndefined(videoDecoderHardwareAcceleration) || _.isString(videoDecoderHardwareAcceleration), "videoDecoderHardwareAcceleration must be string");
        assert(_.isUndefined(timeActions) || _.isObject(timeActions), "timeActions must be Object");
        timeActions && Object.keys(timeActions).forEach(key => {
            key = Number(key);
            assert(_.isFinite(key), `timeActions key ${key} must be Number`);
            assert(_.isFunction(timeActions[key]), `timeActions[${key}] must be Function`);
        });
        this.url = url;
        this.content = content;
        this.startTime = startTime;
        this.autostartRender = _.defaultTo(autostartRender, true);
        this.consoleLog = _.defaultTo(consoleLog, false);
        this.videoPreprocessLog = _.defaultTo(videoPreprocessLog, false);
        this.pageViewport = pageViewport;
        this.pageWaitForOptions = pageWaitForOptions;
        this.pagePrepareFn = pagePrepareFn;
        this.videoDecoderHardwareAcceleration = videoDecoderHardwareAcceleration;
        this.timeActions = timeActions;
    }

    /**
     * 启动合成
     */
    start() {
        this.#abortCallback = null;
        this.#asyncLock.acquire("start", () => this.#synthesize())
            .catch(err => logger.error(err));
    }

    /**
     * 启动并等待完成
     */
    async startAndWait() {
        await this.#asyncLock.acquire("start", () => this.#synthesize());
    }

    /**
     * 终止捕获
     */
    abort() {
        if(!this.#abortCallback)
            return this.#abortCallback;
        this.#abortCallback();
    }

    /**
     * 注册字体
     * 
     * @param {Font} font - 字体对象
     */
    registerFont(font) {
        if (!(font instanceof Font))
            font = new Font(font);
        // 开始加载字体
        font.load();
        this.fonts.push(font);
    }

    /**
     * 注册多个字体
     * 
     * @param {Font[]} fonts - 字体对象列表
     */
    registerFonts(fonts = []) {
        fonts.forEach(font => this.registerFont(font));
    }

    /**
     * 合成处理
     */
    async #synthesize() {
        const page = await this.#acquirePage();
        try {
            const { url, content, width, height, pageWaitForOptions, pageViewport = {} } = this;
            // 监听页面实例发生的某些内部错误
            page.on("error", err => this._emitError("Page error:\n" + err.stack));
            // 监听页面是否崩溃，当内存不足或过载时可能会崩溃
            page.on("crashed", err => this.#emitPageCrashedError(err));
            if (this.consoleLog) {
                // 监听页面打印到console的正常日志
                page.on("consoleLog", message => logger.log("[page]", message));
                // 监听页面打印到console的错误日志
                page.on("consoleError", err => logger.error("[page]", err));
            }
            if (this.videoPreprocessLog)
                page.on("videoPreprocess", config => logger.log("[video_preprocess]", config.url));
            page.on("audioAdd", options => this.addAudio(options));
            page.on("audioUpdate", (audioId, options) => this.updateAudio(audioId, options));
            // 设置视窗宽高
            await page.setViewport({
                ...pageViewport,
                width,
                height
            });
            // 跳转到您希望渲染的页面，您可以考虑创建一个本地的Web服务器提供页面以提升加载速度和安全性
            if (url)
                await page.goto(url, pageWaitForOptions);
            // 或者设置页面内容
            else
                await page.setContent(content, pageWaitForOptions);
            // 存在透明通道时设置背景透明度
            this.hasAlphaChannel && page.setBackgroundOpacity(this.backgroundOpacity);
            // 存在预处理函数时先执行预处理
            this.pagePrepareFn && await this.pagePrepareFn(page);
            // 注册字体
            if (this.fonts.length > 0)
                page.registerFonts(this.fonts);
            // 等待字体加载完成
            await page.waitForFontsLoaded();
            // 注册事件序列
            if (this.timeActions && Object.keys(this.timeActions).length > 0)
                page.registerTimeActions(this.timeActions);
            // 注册终止回调
            this.#abortCallback = () => page.target.evaluate(() => captureCtx.abort()).catch(err => console.error(err));
            // 启动合成
            super.start();
            // 合成完成promise
            const completedPromise = new Promise(resolve => this.once("completed", resolve));
            // 监听已渲染的帧输入到合成器
            page.on("frame", buffer => this.input(buffer));
            // 启动捕获
            await page.startScreencast({
                fps: this.fps,
                startTime: this.startTime,
                duration: this.duration,
                videoDecoderHardwareAcceleration: this.videoDecoderHardwareAcceleration,
                autostart: this.autostartRender
            });
            // 监听并等待录制完成
            await new Promise(resolve => page.once("screencastCompleted", resolve));
            // 停止录制
            await page.stopScreencast();
            // 释放页面资源
            await page.release();
            // 告知合成器结束输入
            this.endInput();
            // 等待合成完成
            await completedPromise;
        }
        catch (err) {
            await page.release();
            this._emitError(err);
        }
    }

    /**
     * 注册页面获取函数
     * 
     * @param {Function} fn 
     */
    onPageAcquire(fn) {
        assert(_.isFunction(fn), "Page acquire function must be Function");
        this.#pageAcquireFn = fn;
    }

    /**
     * 获取渲染页面
     * 
     * @protected
     * @returns {Page} - 页面对象
     */
    async #acquirePage() {
        assert(_.isFunction(this.#pageAcquireFn), "Page acquire function must be Function");
        return await this.#pageAcquireFn();
    }

    /**
     * 发送页面崩溃错误
     * 
     * @param {Error} err - 错误对象
     */
    #emitPageCrashedError(err) {
        if (this.eventNames().includes("pageCrashed"))
            this.emit("pageCrashed", err);
        else
            logger.error("Page crashed:\n" + err.stack);
    }

}

const TRANSITION_IDS = Object.values(TRANSITION);

class Transition {

    /** @type {string} - 转场ID */
    id;
    /** @type {number} - 转场时长 */
    duration;

    /**
     * 构造函数
     * 
     * @param {Object} options - 转场选项
     * @param {string} options.id - 转场ID
     * @param {number} [options.duration=500] - 转场时长（毫秒）
     */
    constructor(options) {
        assert(_.isObject(options), "Transition options must be Object");
        const { id, duration } = options;
        assert(_.isString(id), "Transition id must be string");
        assert(TRANSITION_IDS.includes(id), `Transition id ${id} may not be supported, please refer to http://trac.ffmpeg.org/wiki/Xfade`);
        assert(_.isUndefined(duration) || _.isNumber(duration), "Transition duration must be number");
        this.id = id;
        this.duration = _.defaultTo(duration, 500);
    }

}

/**
 * 视频分块
 */
class VideoChunk extends Synthesizer {

    /** @type {Transition} - 进入下一视频分块的转场 */
    transition;
    /** @type {boolean} - 被合并后是否自动删除分块文件 */
    autoremove;

    /**
     * 构造函数
     * 
     * @param {Object} options - 分块合成器选项
     * @param {number} options.width - 视频宽度
     * @param {number} options.height - 视频高度
     * @param {number} options.fps - 视频合成帧率
     * @param {number} options.duration - 视频时长
     * @param {string} [options.outputPath] - 导出视频分块路径
     * @param {string|Transition} [options.transition] - 进入下一视频分块的转场
     * @param {boolean} [options.autoremove=true] - 分块被合并后是否自动删除分块文件
     * @param {string} [options.videoEncoder] - 视频编码器
     * @param {number} [options.videoQuality] - 视频质量（0-100）
     * @param {string} [options.videoBitrate] - 视频码率（设置码率将忽略videoQuality）
     * @param {string} [options.pixelFormat] - 像素格式（yuv420p/yuv444p/rgb24）
     * @param {number} [options.parallelWriteFrames=10] - 并行写入帧数
     * @param {boolean} [options.showProgress=false] - 是否在命令行展示进度
     */
    constructor(options = {}) {
        super(options);
        const { transition, autoremove } = options;
        this.outputPath = _.defaultTo(this.outputPath, path.join(this.tmpDirPath, `${uniqid("chunk_")}.ts`));
        this.name = _.defaultTo(this.name, path.basename(this.outputPath));
        assert(util.getPathExtname(this.outputPath) == "ts", "Video chunk output path extname must be .ts");
        transition && this.setTransition(transition);
        this.autoremove = _.defaultTo(autoremove, true);
        this.coverCapture = false;
        this.format = "mpegts";
        const encodingType = this.getVideoEncodingType();
        assert(_.isString(BITSTREAM_FILTER[encodingType]), `Video encoder ${this.videoEncoder} does not support use in VideoChunk, only support encoding using H264, H265, and VP9`);
    }

    /**
     * 添加音频
     * 
     * @param {Audio} audio - 音频对象
     */
    addAudio(audio) {
        if (!(audio instanceof Audio))
            audio = new Audio(audio);
        this.audios.push(audio);
        return audio;
    }

    /**
     * 设置合成下一视频分块时的转场
     * 
     * @param {Transition} transition - 转场对象
     */
    setTransition(transition) {
        if (_.isString(transition))
            transition = new Transition({ id: transition });
        else if (!(transition instanceof Transition))
            transition = new Transition(transition);
        this.transition = transition;
    }

    /**
     * 获取已合成视频时长
     * 
     * @returns {number} - 已合成视频时长
     */
    getOutputDuration() {
        return super.getOutputDuration() - this.transitionDuration;
    }

    /**
     * 创建视频编码器
     * 
     * @protected
     * @returns {FfmpegCommand} - 编码器
     */
    _createVideoEncoder() {
        const encodingType = this.getVideoEncodingType();
        const bitstreamFilter = BITSTREAM_FILTER[encodingType];
        const vencoder = super._createVideoEncoder();
        vencoder.outputOption(`-bsf:v ${bitstreamFilter}`);
        return vencoder;
    }

    /**
     * 判断是否VideoChunk
     * 
     * @protected
     * @returns {boolean} - 是否为VideoChunk
     */
    _isVideoChunk() {
        return true;
    }

    /**
     * 获取转场ID
     */
    get transitionId() {
        return this.transition ? this.transition.id : 0;
    }

    /**
     * 获取转场时长
     */
    get transitionDuration() {
        return this.transition ? this.transition.duration : 0;
    }

}

/**
 * @typedef {import('puppeteer-core').WaitForOptions} WaitForOptions
 * @typedef {import('puppeteer-core').Viewport} Viewport
 */

/**
 * 分块视频
 */
class ChunkVideo extends VideoChunk {

    /** @type {string} - 页面URL */
    url;
    /** @type {string} - 页面内容 */
    content;
    /** @type {number} - 开始捕获时间点 */
    startTime;
    /** @type {Font[]} - 注册的字体 */
    fonts = [];
    /** @type {boolean} - 是否自动启动渲染 */
    autostartRender;
    /** @type {boolean} - 是否输出页面控制台日志 */
    consoleLog;
    /** @type {boolean} - 是否输出视频预处理日志 */
    videoPreprocessLog;
    /** @type {Viewport} - 页面视窗参数 */
    pageViewport;
    /** @type {Function} - 页面预处理函数 */
    pagePrepareFn;
    /** @type {{[key: number]: Function}} - 动作序列 */
    timeActions;
    /** @type {Function} - 终止回调函数 */
    #abortCallback = null;
    /** @type {Function} - 页面获取函数 */
    #pageAcquireFn = null;
    /** @type {AsyncLock} - 异步锁 */
    #asyncLock = new AsyncLock();

    /**
     * 构造函数
     * 
     * @param {Object} options - 分块视频选项
     * @param {string} [options.url] - 页面URL
     * @param {string} [options.content] - 页面内容
     * @param {string} options.outputPath - 输出路径
     * @param {number} options.width - 视频宽度
     * @param {number} options.height - 视频高度
     * @param {number} options.duration - 视频时长
     * @param {number} [options.startTime] - 开始捕获时间点
     * @param {number} [options.fps=30] - 视频帧率
     * @param {string|Transition} [options.transition] - 进入下一视频分块的转场效果
     * @param {string} [options.format] - 导出视频格式（mp4/webm）
     * @param {string} [options.attachCoverPath] - 附加到视频首帧的封面路径
     * @param {string} [options.coverCapture=false] - 是否捕获封面并输出
     * @param {number} [options.coverCaptureTime] - 封面捕获时间点（毫秒）
     * @param {string} [options.coverCaptureFormat="jpg"] - 封面捕获格式（jpg/png/bmp）
     * @param {string} [options.videoEncoder="libx264"] - 视频编码器
     * @param {number} [options.videoQuality=100] - 视频质量（0-100）
     * @param {string} [options.videoBitrate] - 视频码率（设置码率将忽略videoQuality）
     * @param {string} [options.pixelFormat="yuv420p"] - 像素格式（yuv420p/yuv444p/rgb24）
     * @param {string} [options.audioEncoder="aac"] - 音频编码器
     * @param {string} [options.audioBitrate] - 音频码率
     * @param {number} [options.volume] - 视频音量（0-100）
     * @param {number} [options.parallelWriteFrames=10] - 并行写入帧数
     * @param {boolean} [options.showProgress=false] - 是否在命令行展示进度
     * @param {boolean} [options.backgroundOpacity=1] - 背景不透明度（0-1），仅webm格式支持
     * @param {boolean} [options.autostartRender=true] - 是否自动启动渲染，如果为false请务必在页面中执行 captureCtx.start()
     * @param {boolean} [options.consoleLog=false] - 是否开启控制台日志输出
     * @param {boolean} [options.videoPreprocessLog=false] - 是否开启视频预处理日志输出
     * @param {string} [options.videoDecoderHardwareAcceleration] - VideoDecoder硬件加速指示
     * @param {WaitForOptions} [options.pageWaitForOptions] - 页面等待选项
     * @param {Viewport} [options.pageViewport] - 页面视窗参数
     * @param {Function} [options.pagePrepareFn] - 页面预处理函数
     * @param {Function} [options.pagePrepareFn] - 页面预处理函数
     */
    constructor(options = {}) {
        super(options);
        assert(_.isObject(options), "options must be Object");
        const { url, content, startTime, autostartRender, consoleLog, videoPreprocessLog, pageWaitForOptions, pageViewport, pagePrepareFn, videoDecoderHardwareAcceleration, timeActions } = options;
        assert(_.isUndefined(url) || util.isURL(url), `url ${url} is not valid URL`);
        assert(_.isUndefined(content) || _.isString(content), "page content must be string");
        assert(!_.isUndefined(url) || !_.isUndefined(content), "page url or content must be provide");
        assert(_.isUndefined(startTime) || _.isFinite(startTime), "startTime must be number");
        assert(_.isUndefined(autostartRender) || _.isBoolean(autostartRender), "autostartRender must be boolean");
        assert(_.isUndefined(consoleLog) || _.isBoolean(consoleLog), "consoleLog must be boolean");
        assert(_.isUndefined(pageWaitForOptions) || _.isObject(pageWaitForOptions), "pageWaitForOptions must be Object");
        assert(_.isUndefined(pageViewport) || _.isObject(pageViewport), "pageViewport must be Object");
        assert(_.isUndefined(pagePrepareFn) || _.isFunction(pagePrepareFn), "pagePrepareFn must be Function");
        assert(_.isUndefined(videoDecoderHardwareAcceleration) || _.isString(videoDecoderHardwareAcceleration), "videoDecoderHardwareAcceleration must be string");
        assert(_.isUndefined(timeActions) || _.isObject(timeActions), "timeActions must be Object");
        timeActions && Object.keys(timeActions).forEach(key => {
            key = Number(key);
            assert(_.isFinite(key), `timeActions key ${key} must be Number`);
            assert(_.isFunction(timeActions[key]), `timeActions[${key}] must be Function`);
        });
        this.url = url;
        this.content = content;
        this.startTime = startTime;
        this.autostartRender = _.defaultTo(autostartRender, true);
        this.consoleLog = _.defaultTo(consoleLog, false);
        this.videoPreprocessLog = _.defaultTo(videoPreprocessLog, false);
        this.pageWaitForOptions = pageWaitForOptions;
        this.pageViewport = pageViewport;
        this.pagePrepareFn = pagePrepareFn;
        this.videoDecoderHardwareAcceleration = videoDecoderHardwareAcceleration;
        this.timeActions = timeActions;
    }

    /**
     * 启动合成
     */
    start() {
        this.#abortCallback = null;
        this.#asyncLock.acquire("start", () => this.#synthesize())
            .catch(err => logger.error(err));
    }

    /**
     * 启动并等待完成
     */
    async startAndWait() {
        await this.#asyncLock.acquire("start", () => this.#synthesize());
    }

    /**
     * 终止捕获
     */
    abort() {
        if(!this.#abortCallback)
            return this.#abortCallback;
        this.#abortCallback();
    }

    /**
     * 注册字体
     * 
     * @param {Font} font - 字体对象
     */
    registerFont(font) {
        if (!(font instanceof Font))
            font = new Font(font);
        // 开始加载字体
        font.load();
        this.fonts.push(font);
    }

    /**
     * 注册多个字体
     * 
     * @param {Font[]} fonts - 字体对象列表
     */
    registerFonts(fonts = []) {
        fonts.forEach(font => this.registerFont(font));
    }

    /**
     * 合成处理
     */
    async #synthesize() {
        const page = await this.#acquirePage();
        try {
            const { url, content, width, height, pageWaitForOptions, pageViewport = {} } = this;
            // 监听页面实例发生的某些内部错误
            page.on("error", err => this._emitError("Page error:\n" + err.stack));
            // 监听页面是否崩溃，当内存不足或过载时可能会崩溃
            page.on("crashed", err => this.#emitPageCrashedError(err));
            if (this.consoleLog) {
                // 监听页面打印到console的正常日志
                page.on("consoleLog", message => logger.log("[page]", message));
                // 监听页面打印到console的错误日志
                page.on("consoleError", err => logger.error("[page]", err));
            }
            if (this.videoPreprocessLog)
                page.on("videoPreprocess", config => logger.log("[video_preprocess]", config.url));
            page.on("audioAdd", options => {
                this.addAudio(options);
                this.emit("audioAdd", options);
            });
            page.on("audioUpdate", (audioId, options) => {
                this.updateAudio(audioId, options);
                this.emit("audioUpdate", options);
            });
            // 设置视窗宽高
            await page.setViewport({
                width,
                height,
                ...pageViewport
            });
            // 跳转到您希望渲染的页面，您可以考虑创建一个本地的Web服务器提供页面以提升加载速度和安全性
            if (url)
                await page.goto(url, pageWaitForOptions);
            // 或者设置页面内容
            else
                await page.setContent(content, pageWaitForOptions);
            // 存在透明通道时设置背景透明度
            this.hasAlphaChannel && page.setBackgroundOpacity(this.backgroundOpacity);
            // 存在预处理函数时先执行预处理
            this.pagePrepareFn && await this.pagePrepareFn(page);
            // 注册字体
            if (this.fonts.length > 0)
                page.registerFonts(this.fonts);
            // 等待字体加载完成
            await page.waitForFontsLoaded();
            // 注册事件序列
            if (this.timeActions && Object.keys(this.timeActions).length > 0)
                page.registerTimeActions(this.timeActions);
             // 注册终止回调
             this.#abortCallback = () => page.target.evaluate(() => captureCtx.abort()).catch(err => console.error(err));
            // 启动合成
            super.start();
            // 合成完成promise
            const completedPromise = new Promise(resolve => this.once("completed", resolve));
            // 监听已渲染的帧输入到合成器
            page.on("frame", buffer => this.input(buffer));
            // 启动捕获
            await page.startScreencast({
                fps: this.fps,
                startTime: this.startTime,
                duration: this.duration,
                videoDecoderHardwareAcceleration: this.videoDecoderHardwareAcceleration,
                autostart: this.autostartRender
            });
            // 监听并等待录制完成
            await new Promise(resolve => page.once("screencastCompleted", resolve));
            // 停止录制
            await page.stopScreencast();
            // 释放页面资源
            await page.release();
            // 告知合成器结束输入
            this.endInput();
            // 等待合成完成
            await completedPromise;
        }
        catch (err) {
            await page.release();
            this._emitError(err);
        }
    }

    /**
     * 注册页面获取函数
     * 
     * @param {Function} fn 
     */
    onPageAcquire(fn) {
        assert(_.isFunction(fn), "Page acquire function must be Function");
        this.#pageAcquireFn = fn;
    }

    /**
     * 获取渲染页面
     * 
     * @protected
     * @returns {Page} - 页面对象
     */
    async #acquirePage() {
        assert(_.isFunction(this.#pageAcquireFn), "Page acquire function must be Function");
        return await this.#pageAcquireFn();
    }

    /**
     * 发送页面崩溃错误
     * 
     * @param {Error} err - 错误对象
     */
    #emitPageCrashedError(err) {
        if (this.eventNames().includes("pageCrashed"))
            this.emit("pageCrashed", err);
        else
            logger.error("Page crashed:\n" + err.stack);
    }

}

/**
 * 视频分块合成器
 */
class ChunkSynthesizer extends Synthesizer {

    /** @type {VideoChunk[]} - 视频块列表 */
    chunks = [];

    /**
     * 构造函数
     * 
     * @param {Object} options - 视频分块合成器选项
     * @param {string} options.outputPath - 导出视频路径
     * @param {number} options.width - 视频宽度
     * @param {number} options.height - 视频高度
     * @param {VideoChunk[]} options.chunks - 视频分块列表
     * @param {number} [options.fps=30] - 视频合成帧率
     * @param {string} [options.format] - 导出视频格式（mp4/webm）
     * @param {string} [options.attachCoverPath] - 附加到视频首帧的封面路径
     * @param {string} [options.coverCapture=false] - 是否捕获封面并输出
     * @param {number} [options.coverCaptureTime] - 封面捕获时间点（毫秒）
     * @param {string} [options.coverCaptureFormat="jpg"] - 封面捕获格式（jpg/png/bmp）
     * @param {string} [options.videoEncoder="libx264"] - 视频编码器
     * @param {number} [options.videoQuality=100] - 视频质量（0-100）
     * @param {string} [options.videoBitrate] - 视频码率（设置码率将忽略videoQuality）
     * @param {string} [options.pixelFormat="yuv420p"] - 像素格式（yuv420p/yuv444p/rgb24）
     * @param {string} [options.audioEncoder="aac"] - 音频编码器
     * @param {string} [options.audioBitrate] - 音频码率
     * @param {number} [options.volume] - 视频音量（0-100）
     * @param {number} [options.parallelWriteFrames=10] - 并行写入帧数
     * @param {boolean} [options.showProgress=false] - 是否在命令行展示进度
     */
    constructor(options) {
        assert(_.isObject(options), "ChunkSynthesizer options must be object");
        options.duration = 0;
        super(options);
        const { chunks } = options;
        assert(_.isUndefined(chunks) || _.isArray(chunks), "chunks must be VideoChunk[]");
        if (this.showProgress) {
            this._cliProgress = new cliProgress.MultiBar({
                hideCursor: true,
                format: `[${"{bar}".cyan}] {percentage}% | {value}/{total} | {eta_formatted} | {filename}`,
            }, cliProgress.Presets.shades_grey);
        }
        chunks && chunks.forEach(chunk => this.input(chunk));
    }

    /**
     * 输入视频分块
     * 
     * @param {VideoChunk} chunk - 视频分块
     * @param {Transition} [transition] - 进入下一分块的转场对象
     */
    input(chunk, transition) {
        _.isFinite(this.width) && (chunk.width = _.defaultTo(chunk.width, this.width));
        _.isFinite(this.height) && (chunk.height = _.defaultTo(chunk.height, this.height));
        _.isFinite(this.fps) && (chunk.fps = _.defaultTo(chunk.fps, this.fps));
        if (!(chunk instanceof VideoChunk))
            chunk = new VideoChunk(chunk);
        assert(chunk.width == this.width, "input chunk width does not match the previous block");
        assert(chunk.height == this.height, "input chunk height does not match the previous block");
        assert(chunk.fps == this.fps, "input chunk fps does not match the previous block");
        transition && chunk.setTransition(_.isString(transition) ? { id: transition } : transition);
        if (this.showProgress)
            chunk.attachCliProgress(this._cliProgress);
        this.chunks.push(chunk);
        this.width = chunk.width;
        this.height = chunk.height;
        this.fps = chunk.fps;
        this.duration += chunk.getOutputDuration();
        this._targetFrameCount += chunk.targetFrameCount;
    }

    /**
     * 屏蔽结束输入
     */
    endInput() {}

    /**
     * 启动合成
     */
    start() {
        assert(this.chunks.length > 0, "There is no VideoChunk that can be synthesized");
        this._startupTime = performance.now();
        let offsetTime = 0;
        const chunksRenderPromises = [];
        this.chunks.forEach(chunk => {
            chunk.audios.forEach(audio => {
                if (!_.isFinite(audio.startTime))
                    audio.startTime = 0;
                audio.startTime += offsetTime;
                if (!_.isFinite(audio.endTime))
                    audio.endTime = chunk.duration;
                audio.endTime += offsetTime;
                this.addAudio(audio);
            });
            // 分块未完成时先进行渲染
            !chunk.isCompleted() && chunksRenderPromises.push(this.renderChunk(chunk, offsetTime));
            offsetTime += chunk.getOutputDuration();
        });
        // 等待分块渲染完成再开始合成流程
        Promise.all(chunksRenderPromises)
            .then(() => super.start())
            .catch(err => this._emitError(err));
    }

    /**
     * 渲染分块
     * 
     * @param {VideoChunk} chunk - 视频分块
     * @param {number} offsetTime - 分块偏移时间点
     */
    async renderChunk(chunk, offsetTime) {
        if (chunk.isCompleted())
            return;
        return await new Promise((resolve, reject) => {
            chunk.on("audioAdd", options => {
                const audio = this.addAudio(options);
                if (!_.isFinite(audio.startTime))
                    audio.startTime = 0;
                audio.startTime += offsetTime;
                if (!_.isFinite(audio.endTime))
                    audio.endTime = chunk.duration;
                audio.endTime += offsetTime;
            });
            chunk.on("audioUpdate", options => {
                if (_.isFinite(options.startTime))
                    options.startTime += offsetTime;
                if (_.isFinite(options.endTime))
                    options.endTime += offsetTime;
                this.updateAudio(options);
            });
            chunk.on("progress", () => this._emitChunksProgress());
            chunk.once("completed", resolve);
            chunk.once("error", reject);
            chunk.isReady() && chunk.start();
        });
    }

    /**
     * 发送进度事件
     */
    _emitChunksProgress() {
        const { progress: totalProgress, frameCount: totalFrameCount } = this.chunks.reduce((total, chunk) => {
            total.progress += chunk.progress;
            total.frameCount += chunk.frameCount;
            return total;
        }, {
            progress: 0,
            frameCount: 0
        });
        this.progress = Math.floor(totalProgress / this.chunks.length * 0.95 * 1000) / 1000;
        this._frameCount = totalFrameCount;
        this.emit("progress", this.progress * 0.95, totalFrameCount, this._targetFrameCount);
    }

    /**
     * 发送进度事件
     * 
     * @protected
     * @param {number} value - 进度值
     */
    _emitProgress(value, frameCount, targetFrameCount) {
        if (value < 0)
            return;
        let progress = this.progress + Math.floor(value * 0.05 * 1000) / 1000;
        if (progress > 100)
            progress = 100;
        if (this.showProgress) {
            if(this._cliProgress instanceof cliProgress.MultiBar) {
                this._cliProgress.stop();
                this._cliProgress = new cliProgress.SingleBar({
                    hideCursor: true,
                    format: `[${"{bar}".green}] {percentage}% | {value}/{total} | {eta_formatted} | {filename}`,
                }, cliProgress.Presets.shades_grey);
            }
            if (!this._cliProgress.started) {
                logger.log(`Waiting to merge ${this.chunks.length} chunks and audio synthesis...`);
                this._cliProgress.start(targetFrameCount, 0);
                this._cliProgress.started = true;
            }
            this._cliProgress.update(frameCount, { filename: this.name });
        }
        this.emit("progress", progress, this._frameCount, this._targetFrameCount);
    }

    /**
     * 发送已完成事件
     * 
     * @protected
     */
    _emitCompleted() {
        Promise.all(this.chunks.map(chunk => chunk.autoremove && fs.remove(chunk.outputPath)))
            .catch(err => logger.error(err));
        super._emitCompleted();
    }

    /**
     * 创建视频编码器
     * 
     * @protected
     * @returns {FfmpegCommand} - 编码器
     */
    _createVideoEncoder() {
        const { chunks, width, height, _swapFilePath, format,
            videoEncoder, videoBitrate, videoQuality, pixelFormat, attachCoverPath } = this;
        const vencoder = ffmpeg();
        // 设置视频码率将忽略质量设置
        if (videoBitrate)
            vencoder.videoBitrate(videoBitrate);
        else {
            // 计算总像素量
            const pixels = width * height;
            // 根据像素总量设置视频码率
            vencoder.videoBitrate(`${(2560 / 921600 * pixels) * (videoQuality / 100)}k`);
        }
        // 输入命令集合
        const inputs = [];
        // 复合过滤器
        let complexFilter = '';
        // 时长偏移
        let durationOffset = 0;
        // 上一个输出索引
        let lastOutput = null;
        for (let i = 0; i < chunks.length; i++) {
            // 当前分块
            const chunk = chunks[i];
            // 获取上一个分块
            const lastChunk = i > 0 ? chunks[i - 1] : null;
            // 如果存在上一分块则处理转场
            if (lastChunk) {
                // 当前输入索引
                const index = inputs.length ? inputs.length - 1 : 0;
                // 如果上一分块存在转场则填充输入和过滤器
                if (lastChunk.transition) {
                    // 将此分块路径添加到输入
                    inputs.push(chunk.outputPath);
                    // 如果存在上层输出则使用否则以当前块作为输入
                    const input = lastOutput || `[${index}:v]`;
                    // 输出索引
                    const output = `[v${index}]`;
                    // 获取上一分块转场参数
                    let { id: transtiionId, duration: transitionDuration } = lastChunk.transition;
                    // 上一分块时长减去当前转场时长获得偏移量
                    durationOffset += (lastChunk.duration - transitionDuration);
                    // 添加转场到复合过滤器
                    complexFilter += `${input}[${index + 1}:v]xfade=transition=${transtiionId}:duration=${Math.floor(transitionDuration / 1000 * 100) / 100}:offset=${Math.floor(durationOffset / 1000 * 100) / 100}${output};`;
                    // 设置当前输出索引用于下次处理
                    lastOutput = output;
                }
                // 如果没有转场则直接拼接加快合成速度
                else {
                    // 偏移上一分块时长
                    durationOffset += lastChunk.duration;
                    // 如果最后一个输入不存在或者输入非拼接态将处理为拼接
                    if (!inputs[index] || inputs[index].indexOf("concat") !== 0)
                        inputs[index] = `concat:${lastChunk.outputPath}|${chunk.outputPath}`;
                    else
                        inputs[index] += `|${chunk.outputPath}`;  //拼到拼接态字符串尾部
                }
            }
            // 不存在上一分块直接作为输入
            else
                inputs.push(chunk.outputPath);
        }
        // 将所有分块输出路径输入
        inputs.forEach(input => vencoder.addInput(input));
        // 获取任务封面路径
        if (attachCoverPath) {
            vencoder.addInput(attachCoverPath);
            const output = `[v${inputs.length}]`;
            complexFilter += `[${inputs.length}:v]scale=${width}:${height}[cover];${lastOutput || "[0:v]"}[cover]overlay=repeatlast=0${output};`;
            inputs.push(attachCoverPath);
            lastOutput = output;
        }
        // 如采用复合过滤器将应用
        if (complexFilter) {
            vencoder.complexFilter(complexFilter.replace(`${lastOutput};`, `,format=${pixelFormat}[output]`));
            vencoder.outputOption("-map [output]");
        }
        // 获取编码类型
        const encodingType = this.getVideoEncodingType();
        if (encodingType == "H264" || encodingType == "H265") {
            // 使用主要配置
            vencoder.outputOption("-profile:v main");
            // 使用中等预设
            vencoder.outputOption("-preset medium");
        }
        vencoder
            // 指定视频编码器
            .videoCodec(videoEncoder)
            // 移动MOOV头到前面
            .outputOption("-movflags +faststart")
            // 指定输出格式
            .toFormat(format)
            .addOutput(_swapFilePath);
        return vencoder;
    }

    /**
     * 获取已合成视频时长
     * 
     * @returns {number} - 已合成视频时长
     */
    getOutputDuration() {
        return this.duration;
    }

}

/**
 * 多幕视频
 */
class MultiVideo extends ChunkSynthesizer {

    /** @type {number} - 开始捕获时间点 */
    startTime;
    /** @type {Font[]} - 注册的字体 */
    fonts = [];
    /** @type {Function} - 页面预处理函数 */
    pagePrepareFn;
    /** @type {{[key: number]: Function}} - 动作序列 */
    timeActions;
    /** @type {Function} - 页面获取函数 */
    #pageAcquireFn = null;
    /** @type {AsyncLock} - 异步锁 */
    #asyncLock = new AsyncLock();

    /**
     * 构造函数
     * 
     * @param {Object} options - 序列帧合成器选项
     * @param {string} options.outputPath - 导出视频路径
     * @param {number} options.width - 视频宽度
     * @param {number} options.height - 视频高度
     * @param {ChunkVideo[]} options.chunks - 分块视频列表
     * @param {number} [options.startTime=0] - 开始捕获时间点
     * @param {number} [options.fps=30] - 视频合成帧率
     * @param {string} [options.format] - 导出视频格式（mp4/webm）
     * @param {string} [options.attachCoverPath] - 附加到视频首帧的封面路径
     * @param {string} [options.coverCapture=false] - 是否捕获封面并输出
     * @param {number} [options.coverCaptureTime] - 封面捕获时间点（毫秒）
     * @param {string} [options.coverCaptureFormat="jpg"] - 封面捕获格式（jpg/png/bmp）
     * @param {string} [options.videoEncoder="libx264"] - 视频编码器
     * @param {number} [options.videoQuality=100] - 视频质量（0-100）
     * @param {string} [options.videoBitrate] - 视频码率（设置码率将忽略videoQuality）
     * @param {string} [options.pixelFormat="yuv420p"] - 像素格式（yuv420p/yuv444p/rgb24）
     * @param {string} [options.audioEncoder="aac"] - 音频编码器
     * @param {string} [options.audioBitrate] - 音频码率
     * @param {number} [options.volume] - 视频音量（0-100）
     * @param {number} [options.parallelWriteFrames=10] - 并行写入帧数
     * @param {boolean} [options.showProgress=false] - 是否在命令行展示进度
     * @param {Function} [options.pagePrepareFn] - 页面预处理函数
     */
    constructor(options) {
        super(options);
        const { startTime, pagePrepareFn } = options;
        assert(_.isUndefined(startTime) || _.isFinite(startTime), "startTime must be number");
        assert(_.isUndefined(pagePrepareFn) || _.isFunction(pagePrepareFn), "pagePrepareFn must be Function");
        this.startTime = startTime;
        this.pagePrepareFn = pagePrepareFn;
    }

    /**
     * 启动合成
     */
    start() {
        this.#asyncLock.acquire("start", () => this.#synthesize())
            .catch(err => logger.error(err));
    }

    /**
     * 启动并等待
     */
    async startAndWait() {
        await this.#asyncLock.acquire("start", () => this.#synthesize());
    }

    /**
     * 输入分块视频
     * 
     * @param {ChunkVideo} chunk - 分块视频
     * @param {Transition} [transition] - 进入下一分块的转场对象
     */
    input(chunk, transition) {
        _.isFinite(this.width) && (chunk.width = _.defaultTo(chunk.width, this.width));
        _.isFinite(this.height) && (chunk.height = _.defaultTo(chunk.height, this.height));
        _.isFinite(this.fps) && (chunk.fps = _.defaultTo(chunk.fps, this.fps));
        if (!(chunk instanceof ChunkVideo))
            chunk = new ChunkVideo(chunk);
        super.input(chunk, transition);
        chunk.onPageAcquire(async () => await this.#acquirePage());
    }

    /**
     * 注册字体
     * 
     * @param {Font} font - 字体对象
     */
    registerFont(font) {
        if (!(font instanceof Font))
            font = new Font(font);
        // 开始加载字体
        font.load();
        this.fonts.push(font);
    }

    /**
     * 注册多个字体
     * 
     * @param {Font[]} fonts - 字体对象列表
     */
    registerFonts(fonts = []) {
        fonts.forEach(font => this.registerFont(font));
    }

    /**
     * 合成处理
     */
    async #synthesize() {
        this.chunks.forEach(chunk => {
            if (_.isUndefined(chunk.startTime) && this.startTime)
                chunk.startTime = this.startTime;
            if (_.isUndefined(chunk.pagePrepareFn) && this.pagePrepareFn)
                chunk.pagePrepareFn = this.pagePrepareFn;
            if (this.fonts.length > 0)
                chunk.registerFonts(this.fonts);
        });
        return await new Promise((resolve, reject) => {
            this.once("error", reject);
            this.once("completed", resolve);
            super.start();
        });
    }

    /**
    * 注册页面获取函数
    * 
    * @param {Function} fn 
    */
    onPageAcquire(fn) {
        assert(_.isFunction(fn), "Page acquire function must be Function");
        this.#pageAcquireFn = fn;
    }

    /**
     * 获取渲染页面
     * 
     * @protected
     * @returns {Page} - 页面对象
     */
    async #acquirePage() {
        assert(_.isFunction(this.#pageAcquireFn), "Page acquire function must be Function");
        return await this.#pageAcquireFn();
    }

}

var cleaner = {

    /**
     * 清理浏览器缓存
     */
    async cleanBrowserCache() {
        await fs.emptyDir("tmp/browser");
    },

    /**
     * 清理预处理器缓存
     */
    async cleanPreprocessCache() {
        await fs.emptyDir("tmp/preprocessor");
    },

    /**
     * 清理合成器缓存
     */
    async cleanSynthesizeCache() {
        await fs.emptyDir("tmp/synthesizer");
    },
    
    /**
     * 清理本地字体缓存
     */
    async cleanLocalFontCache() {
        await fs.emptyDir("tmp/local_font");
    }

};

/**
 * @typedef {import('puppeteer-core').WaitForOptions} WaitForOptions
 * @typedef {import('puppeteer-core').Viewport} Viewport
 */

class WebVideoCreator {

    /** @type {ResourcePool} - 资源池 */
    pool = null;
    /** @type {boolean} - 是否已配置 */
    #configured = false;

    /**
     * 配置引擎
     * 
     * @param {Object} config - 配置对象
     * @param {string} config.mp4Encoder - 全局MP4格式的视频编码器，默认使用libx264软编码器，建议根据您的硬件选用合适的硬编码器加速合成
     * @param {string} config.webmEncoder - 全局WEBM格式的视频编码器，默认使用libvpx软编码器，建议根据您的硬件选用合适的硬编码器加速合成
     * @param {string} config.audioEncoder - 全局音频编码器，建议采用默认的aac编码器
     * @param {boolean} config.browserUseGPU - 浏览器GPU加速开关，建议开启提高渲染性能，如果您没有GPU设备或遭遇了诡异的渲染问题则可以关闭它
     * @param {boolean} config.browserUseAngle - 浏览器是否使用Angle作为渲染后端，建议开启增强渲染跨平台兼容性和性能
     * @param {string} config.browserExecutablePath - 浏览器可执行文件路径，设置后将禁用内部的浏览器，建议您默认使用内部的浏览器以确保功能完整性
     * @param {number} config.numBrowserMin - 资源池可并行的最小浏览器实例数量
     * @param {number} config.numBrowserMax - 资源池可并行的最大浏览器实例数量
     * @param {number} config.numPageMin - 浏览器实例可并行的最小页面实例数量
     * @param {number} conifg.numPageMax - 浏览器实例可并行的最大页面实例数量
     * @param {boolean} config.debug - 开启后将输出一些WVC的调试日志
     * @param {boolean} config.browserDebug - 浏览器Debug开关，开启后将输出浏览器的运行日志，如果您想看页面的日志，请设置视频参数的consoleLog为true，而不是这个
     * @param {boolean} config.ffmpegDebug - FFmpeg Debug开关，开启后将输出每一条执行的ffmpeg命令
     * @param {boolean} config.allowUnsafeContext - 是否允许不安全的上下文，默认禁用，开启后能够导航到不安全的URL，但由于不安全上下文限制，将无法在页面中使用动态图像和内嵌视频
     * @param {boolean} config.compatibleRenderingMode - 兼容渲染模式，如果您使用MacOS请开启他，这将导致渲染效率降低40%，启用后将禁用HeadlessExperimental.beginFrame API调用改为普通的Page.screenshot
     * @param {string} config.browserVersion - 指定WVC使用的Chrome浏览器版本
     * @param {boolean} config.browserHeadless - 浏览器无头开关，建议保持开启，如果关闭请确保开启兼容渲染模式否则无法渲染，仅用于调试画面
     * @param {boolean} config.browserFrameRateLimit - 浏览器帧率限制开关，默认开启，关闭帧率限制可以提高渲染效率并支持高于60fps的动画，但这会关闭GPU垂直同步可能导致画面撕裂或其它问题
     * @param {string} config.ffmpegExecutablePath - ffmpeg可执行文件路径，设置后将禁用内部的ffmpeg-static，建议您默认使用内部的FFmpeg以确保功能完整性
     * @param {string} conifg.ffprobeExecutablePath - ffprobe可执行文件路径，设置后将禁用内部的ffprobe-static，建议您默认使用内部的ffprobe以确保功能完整性
     * @param {string} config.frameFormat - 帧图格式（jpeg/png），建议使用jpeg，png捕获较为耗时
     * @param {number} config.frameQuality - 捕获帧图质量（0-100），仅frameFormat为jpeg时有效
     * @param {number} config.beginFrameTimeout - BeginFrame捕获图像超时时间（毫秒）
     * @param {boolean} config.browserDisableDevShm - 是否禁用浏览器使用共享内存，当/dev/shm分区较小时建议开启此选项
     * @param {number} config.browserLaunchTimeout - 浏览器启动超时时间（毫秒），设置等待浏览器启动超时时间
     * @param {number} config.browserProtocolTimeout - 浏览器协议通信超时时间（毫秒），设置CDP协议通信超时时间
     * @param {string} config.userAgent - 访问页面时的用户UA
     */
    config(config = {}) {
        for (let key in globalConfig) {
            if (!_.isUndefined(config[key]))
                globalConfig[key] = config[key];
        }
        const { ffmpegExecutablePath, ffprobeExecutablePath, browserUseGPU, mp4Encoder } = globalConfig;
        // 未启用浏览器GPU发出性能警告
        if (!browserUseGPU)
            logger.warn("browserUseGPU is turn off, recommended to turn it on to improve rendering performance");
        // 未使用硬编码器发出性能警告
        if (Object.values(VIDEO_ENCODER.CPU).includes(mp4Encoder))
            logger.warn(`Recommended to use video hard coder to accelerate video synthesis, currently used is [${globalConfig.mp4Encoder}]`);
        // 设置FFmpeg可执行文件路径
        ffmpegExecutablePath && ffmpeg.setFfmpegPath(ffmpegExecutablePath);
        // 设置FFprobe可执行文件路径
        ffprobeExecutablePath && ffmpeg.setFfprobePath(ffprobeExecutablePath);
        // 实例化浏览器资源池
        this.pool = new ResourcePool();
        // 设置已配置
        this.#configured = true;
    }

    /**
     * 创建单幕视频
     * 
     * @param {Object} options - 单幕视频选项
     * @param {string} [options.url] - 页面URL
     * @param {string} [options.content] - 页面内容
     * @param {string} options.outputPath - 输出路径
     * @param {number} options.width - 视频宽度
     * @param {number} options.height - 视频高度
     * @param {number} options.duration - 视频时长
     * @param {number} [options.startTime=0] - 开始捕获时间点
     * @param {number} [options.fps=30] - 视频帧率
     * @param {string} [options.format] - 导出视频格式（mp4/webm）
     * @param {string} [options.attachCoverPath] - 附加到视频首帧的封面路径
     * @param {string} [options.coverCapture=false] - 是否捕获封面并输出
     * @param {number} [options.coverCaptureTime] - 封面捕获时间点（毫秒）
     * @param {string} [options.coverCaptureFormat="jpg"] - 封面捕获格式（jpg/png/bmp）
     * @param {string} [options.videoEncoder="libx264"] - 视频编码器
     * @param {number} [options.videoQuality=100] - 视频质量（0-100）
     * @param {string} [options.videoBitrate] - 视频码率（设置码率将忽略videoQuality）
     * @param {string} [options.pixelFormat="yuv420p"] - 像素格式（yuv420p/yuv444p/rgb24）
     * @param {string} [options.audioEncoder="aac"] - 音频编码器
     * @param {string} [options.audioBitrate] - 音频码率
     * @param {number} [options.volume] - 视频音量（0-100）
     * @param {number} [options.parallelWriteFrames=10] - 并行写入帧数
     * @param {boolean} [options.showProgress=false] - 是否在命令行展示进度
     * @param {boolean} [options.backgroundOpacity=1] - 背景不透明度（0-1），仅webm格式支持
     * @param {boolean} [options.autostartRender=true] - 是否自动启动渲染，如果为false请务必在页面中执行 captureCtx.start()
     * @param {boolean} [options.consoleLog=false] - 是否开启控制台日志输出
     * @param {boolean} [options.videoPreprocessLog=false] - 是否开启视频预处理日志输出
     * @param {string} [options.videoDecoderHardwareAcceleration] - VideoDecoder硬件加速指示
     * @param {WaitForOptions} [options.pageWaitForOptions] - 页面等待选项
     * @param {Viewport} [options.pageViewport] - 页面视窗参数
     * @param {Function} [options.pagePrepareFn] - 页面预处理函数
     * @param {{[key: number]: Function}} [options.timeActions] - 动作序列
     */
    createSingleVideo(options) {
        assert(this.#configured, "WebVideoCreator has not been configured yet, please execute config() first");
        const singleVideo = new SingleVideo(options);
        // 注册获取页面函数
        singleVideo.onPageAcquire(async () => await this.pool.acquirePage());
        return singleVideo;
    }

    /**
     * 创建多幕视频
     * 
     * @param {Object} options - 序列帧合成器选项
     * @param {string} options.outputPath - 导出视频路径
     * @param {number} options.width - 视频宽度
     * @param {number} options.height - 视频高度
     * @param {number} options.duration - 视频时长
     * @param {ChunkVideo[]} options.chunks - 分块视频列表
     * @param {number} [options.fps=30] - 视频合成帧率
     * @param {string} [options.format] - 导出视频格式（mp4/webm）
     * @param {string} [options.attachCoverPath] - 附加到视频首帧的封面路径
     * @param {string} [options.coverCapture=false] - 是否捕获封面并输出
     * @param {number} [options.coverCaptureTime] - 封面捕获时间点（毫秒）
     * @param {string} [options.coverCaptureFormat="jpg"] - 封面捕获格式（jpg/png/bmp）
     * @param {string} [options.videoEncoder="libx264"] - 视频编码器
     * @param {number} [options.videoQuality=100] - 视频质量（0-100）
     * @param {string} [options.videoBitrate] - 视频码率（设置码率将忽略videoQuality）
     * @param {string} [options.pixelFormat="yuv420p"] - 像素格式（yuv420p/yuv444p/rgb24）
     * @param {string} [options.audioEncoder="aac"] - 音频编码器
     * @param {string} [options.audioBitrate] - 音频码率
     * @param {number} [options.volume] - 视频音量（0-100）
     * @param {number} [options.parallelWriteFrames=10] - 并行写入帧数
     * @param {boolean} [options.showProgress=false] - 是否在命令行展示进度
     * @param {Function} [options.pagePrepareFn] - 页面预处理函数
     */
    createMultiVideo(options) {
        assert(this.#configured, "WebVideoCreator has not been configured yet, please execute config() first");
        const multiVideo = new MultiVideo(options);
        // 注册获取页面函数
        multiVideo.onPageAcquire(async () => await this.pool.acquirePage());
        return multiVideo;
    }

    /**
     * 创建分块视频
     * 
     * @param {Object} options - 分块视频选项
     * @param {string} [options.url] - 页面URL
     * @param {string} [options.content] - 页面内容
     * @param {string} options.outputPath - 输出路径
     * @param {number} options.width - 视频宽度
     * @param {number} options.height - 视频高度
     * @param {number} options.duration - 视频时长
     * @param {number} [options.startTime=0] - 开始捕获时间点
     * @param {number} [options.fps=30] - 视频帧率
     * @param {Transition} [options.transition] - 进入下一视频分块的转场
     * @param {string} [options.format] - 导出视频格式（mp4/webm）
     * @param {string} [options.attachCoverPath] - 附加到视频首帧的封面路径
     * @param {string} [options.coverCapture=false] - 是否捕获封面并输出
     * @param {number} [options.coverCaptureTime] - 封面捕获时间点（毫秒）
     * @param {string} [options.coverCaptureFormat="jpg"] - 封面捕获格式（jpg/png/bmp）
     * @param {string} [options.videoEncoder="libx264"] - 视频编码器
     * @param {number} [options.videoQuality=100] - 视频质量（0-100）
     * @param {string} [options.videoBitrate] - 视频码率（设置码率将忽略videoQuality）
     * @param {string} [options.pixelFormat="yuv420p"] - 像素格式（yuv420p/yuv444p/rgb24）
     * @param {string} [options.audioEncoder="aac"] - 音频编码器
     * @param {string} [options.audioBitrate] - 音频码率
     * @param {number} [options.volume] - 视频音量（0-100）
     * @param {number} [options.parallelWriteFrames=10] - 并行写入帧数
     * @param {boolean} [options.showProgress=false] - 是否在命令行展示进度
     * @param {boolean} [options.backgroundOpacity=1] - 背景不透明度（0-1），仅webm格式支持
     * @param {boolean} [options.autostartRender=true] - 是否自动启动渲染，如果为false请务必在页面中执行 captureCtx.start()
     * @param {boolean} [options.consoleLog=false] - 是否开启控制台日志输出
     * @param {boolean} [options.videoPreprocessLog=false] - 是否开启视频预处理日志输出
     * @param {string} [options.videoDecoderHardwareAcceleration] - VideoDecoder硬件加速指示
     * @param {WaitForOptions} [options.pageWaitForOptions] - 页面等待选项
     * @param {Viewport} [options.pageViewport] - 页面视窗参数
     * @param {Function} [options.pagePrepareFn] - 页面预处理函数
     * @param {{[key: number]: Function}} [options.timeActions] - 动作序列
     */
    createChunkVideo(options) {
        assert(this.#configured, "WebVideoCreator has not been configured yet, please execute config() first");
        const chunkVideo = new ChunkVideo(options);
        // 注册获取页面函数
        chunkVideo.onPageAcquire(async () => await this.pool.acquirePage());
        return chunkVideo;
    }

    /** 清理浏览器缓存 */
    cleanBrowserCache = cleaner.cleanBrowserCache.bind(cleaner);

    /** 清理预处理缓存 */
    cleanPreprocessCache = cleaner.cleanPreprocessCache.bind(cleaner);

    /** 清理合成缓存 */
    cleanSynthesizeCache = cleaner.cleanSynthesizeCache.bind(cleaner);

    /** 清理本地字体缓存 */
    cleanLocalFontCache = cleaner.cleanLocalFontCache.bind(cleaner);

}

/**
 * 单幕视频合成示例
 * 
 * 调用代码：
 * import { examples, VIDEO_ENCODER } from "web-video-creator";
 * await examples.singleVideo({
 *     url: "http://localhost:8080/test.html",
 *     width: 1280,
 *     height: 720,
 *     fps: 30,
 *     duration: 10000,
 *     videoEncoder: VIDEO_ENCODER.NVIDIA.H264,  // 根据您的硬件设备选择适合的编码器
 *     outputPath: "./test.mp4"
 * });
 */


var singleVideo = async ({
    url,
    width,
    height,
    fps,
    duration,
    videoEncoder,
    outputPath
}) => {
    const wvc = new WebVideoCreator();
    wvc.config({
        mp4Encoder: videoEncoder
    });
    const video = wvc.createSingleVideo({
        url,
        width,
        height,
        fps,
        duration,
        outputPath,
        showProgress: true
    });
    video.once("completed", result => logger.success(`Render Completed!!!\nvideo duration: ${Math.floor(result.duration / 1000)}s\ntakes: ${Math.floor(result.takes / 1000)}s\nRTF: ${result.rtf}`));
    video.start();
};

/**
 * 多幕视频合成示例
 * 
 * 调用代码：
 * import { examples, VIDEO_ENCODER, TRANSITION } from "web-video-creator";
 * await examples.multiVideo({
 *     chunks: [
 *         { url: "http://localhost:8080/scene1.html", duration: 10000, transition: TRANSITION.CIRCLE_CROP },
 *         { url: "http://localhost:8080/scene2.html", duration: 10000 }
 *     ],
 *     width: 1280,
 *     height: 720,
 *     fps: 30,
 *     videoEncoder: VIDEO_ENCODER.NVIDIA.H264,  // 根据您的硬件设备选择适合的编码器
 *     outputPath: "./test.mp4"
 * });
 */


var multiVideo = async ({
    url,
    width,
    height,
    fps,
    chunks,
    duration,
    videoEncoder,
    outputPath
}) => {
    const wvc = new WebVideoCreator();
    wvc.config({
        mp4Encoder: videoEncoder
    });
    const video = wvc.createMultiVideo({
        url,
        width,
        height,
        fps,
        duration,
        outputPath,
        chunks,
        showProgress: true
    });
    video.once("completed", result => logger.success(`Render Completed!!!\nvideo duration: ${Math.floor(result.duration / 1000)}s\ntakes: ${Math.floor(result.takes / 1000)}s\nRTF: ${result.rtf}`));
    video.start();
};

var index$2 = {
    singleVideo,
    multiVideo,
    synthesize: singleVideo,
};

var index$1 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    Browser: Browser,
    CaptureContext: CaptureContext,
    ChunkSynthesizer: ChunkSynthesizer,
    Page: Page,
    ResourcePool: ResourcePool,
    Synthesizer: Synthesizer,
    VideoChunk: VideoChunk
});

var index = /*#__PURE__*/Object.freeze({
    __proto__: null,
    Audio: Audio,
    Font: Font,
    Transition: Transition
});

exports.AUDIO_ENCODER = AUDIO_ENCODER;
exports.ChunkVideo = ChunkVideo;
exports.MultiVideo = MultiVideo;
exports.SingleVideo = SingleVideo;
exports.TRANSITION = TRANSITION;
exports.VIDEO_ENCODER = VIDEO_ENCODER;
exports.core = index$1;
exports.default = WebVideoCreator;
exports.entity = index;
exports.examples = index$2;
exports.logger = logger;
exports.util = util;
