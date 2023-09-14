class CaptureContext {

    // 启动时间点（毫秒）
    startupTime = Date.now();
    // 当前时间点（毫秒）
    currentTime = 0;
    // 当前帧指针
    frameIndex = 0;
    // 帧间隔时间
    frameInterval = 0;
    // 停止标志
    stopFlag = false;
    // 配置
    config = {
        // 渲染帧率
        fps: 0,
        // 目标帧率
        frameCount: 0
    };

    constructor() {
        // 暂存requestAnimationFrame函数
        window.____requestAnimationFrame = window.requestAnimationFrame;
        // 重写requestAnimationFrame，传递上下文提供的currentTime确保在非60fps捕获时实现帧率同步
        window.requestAnimationFrame = fn => !this.stopFlag && window.____requestAnimationFrame(() => fn(this.currentTime));
         // 暂存Date.now函数
         Date.____now = Date.now;
         // 重写Date.now函数，传递上下文提供的currentTime确保在以系统时间作为时基的动画库实现帧率同步
         Date.now = () => this.startupTime + this.currentTime;
         // 重写Date的getTime原型
         Date.prototype.getTime = Date.now;
    }

    /**
     * 开始捕获
     */
    start() {
        // 更新开始时间
        this.startTime = this.getTime();
        // 计算帧间隔时间
        this.frameInterval = 1000 / this.config.fps;
        // 递归捕获帧
        (function nextFrame() {
            (async () => {
                // 捕获帧图 - 此函数请见Page.js的#envInit的exposeFunction
                if(!await window.captureFrame()) {
                    this.stopFlag = true;
                    return;
                }
                // 捕获帧数到达目标帧数时终止捕获
                if (this.frameIndex++ >= this.config.frameCount) {
                    this.stopFlag = true;
                    // 完成录制回调 - 此函数请见Page.js的#envInit的exposeFunction
                    return window.screencastCompleted();
                }
                // 根据帧间隔推进当前时间
                this.currentTime += this.frameInterval;
                // 开始捕获下一帧
                nextFrame.bind(this)();
            })()
                .catch(err => console.error(`${err.message}\n${err.stack}`));
        }).bind(this)();
    }

    /**
     * 设置捕获帧率
     * 
     * @param {number} value - 捕获帧率
     */
    setFPS(value) {
        this.config.fps = Number(value);
    }

    /**
     * 设置捕获时长
     * 
     * @param {number} value - 捕获时长（毫秒）
     */
    setDuration(value) {
        this.config.frameCount = Math.floor(value / 1000 * fps);
    }

    /**
     * 设置捕获总帧数
     * 
     * @param {number} value - 捕获总帧数
     */
    setFrameCount(value) {
        this.config.frameCount = value;
    }

    /**
     * 获取当前现实时间的时间戳
     * 
     * @returns {number} 时间戳
     */
    getTime() {
        return Date.____now ? Date.____now() : Date.now();
    }

}

export default CaptureContext;