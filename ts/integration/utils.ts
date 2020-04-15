import { EventEmitter } from 'events'

export class BufferedEventEmitter {
    private events = new EventEmitter()
    private bufferedEvents: { [eventName: string]: any[] } = {}

    addListener = (eventName: string, handler: (...args: any[]) => void) => {
        this.events.addListener(eventName, handler)
        if (this.events.listeners(eventName).length === 1) {
            // There were no listeners before
            this._emitBufferedEvents(eventName)
        }
    }
    on = this.addListener

    removeListener = (eventName: string, handler: (...args: any[]) => void) => {
        this.events.removeListener(eventName, handler)
    }
    off = this.removeListener

    removeAllListeners = (eventName: string) => {
        this.events.removeAllListeners(eventName)
    }

    emit = (eventName: string, ...params: any[]) => {
        if (this.events.listeners(eventName)) {
            this._emit(eventName, ...params)
        } else {
            this._bufferEvent(eventName, ...params)
        }
    }

    _emit(eventName: string, ...params: any[]) {
        this.events.emit(eventName, ...params)
    }

    _bufferEvent(eventName: string, ...params: any[]) {
        if (!this.bufferedEvents[eventName]) {
            this.bufferedEvents[eventName] = []
        }
        this.bufferedEvents[eventName].push(params)
    }

    _emitBufferedEvents(eventName: string) {
        const events = this.bufferedEvents[eventName] || []
        this.bufferedEvents[eventName] = []
        for (const eventParams of events) {
            this._emit(eventName, ...eventParams)
        }
    }
}
