// Thin C layer over libmgba, called from Bun with bun:ffi.
// mCore is a struct of function pointers; this file hides it behind plain functions.
// flags.h first: it sets the options that change the layout of struct mCore.
#include <mgba/flags.h>
#include <mgba/core/blip_buf.h>
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <stdlib.h>
#include <string.h>

struct LabCore {
	struct mCore* core;
	color_t* video;
	unsigned width;
	unsigned height;
};

static void discardLog(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger; (void) category; (void) level; (void) format; (void) args;
}

static struct mLogger sSilentLogger = { .log = discardLog, .filter = NULL };

struct LabCore* lab_open(const char* romPath) {
	mLogSetDefaultLogger(&sSilentLogger);
	struct mCore* core = mCoreFind(romPath);
	if (!core || !core->init(core)) {
		return NULL;
	}
	mCoreInitConfig(core, NULL);
	struct LabCore* lab = calloc(1, sizeof(*lab));
	lab->core = core;
	core->desiredVideoDimensions(core, &lab->width, &lab->height);
	lab->video = calloc(lab->width * lab->height, sizeof(color_t));
	core->setVideoBuffer(core, lab->video, lab->width);
	if (!mCoreLoadFile(core, romPath)) {
		core->deinit(core);
		free(lab->video);
		free(lab);
		return NULL;
	}
	return lab;
}

void lab_close(struct LabCore* lab) {
	lab->core->deinit(lab->core);
	free(lab->video);
	free(lab);
}

void lab_reset(struct LabCore* lab) {
	lab->core->reset(lab->core);
}

uint32_t lab_width(struct LabCore* lab) { return lab->width; }
uint32_t lab_height(struct LabCore* lab) { return lab->height; }

void lab_set_keys(struct LabCore* lab, uint32_t keys) {
	lab->core->setKeys(lab->core, keys);
}

// Runs one frame. Audio is dropped so the buffers do not fill up.
void lab_run_frame(struct LabCore* lab) {
	lab->core->runFrame(lab->core);
	for (int ch = 0; ch < 2; ++ch) {
		struct blip_t* blip = lab->core->getAudioChannel(lab->core, ch);
		if (blip) {
			blip_clear(blip);
		}
	}
}

uint32_t lab_frame_counter(struct LabCore* lab) {
	return lab->core->frameCounter(lab->core);
}

// Copies the screen as RGBA bytes (width * height * 4).
void lab_frame_rgba(struct LabCore* lab, uint8_t* out) {
	size_t n = (size_t) lab->width * lab->height;
	for (size_t i = 0; i < n; ++i) {
		uint32_t p = lab->video[i];
		out[i * 4 + 0] = p & 0xFF;
		out[i * 4 + 1] = (p >> 8) & 0xFF;
		out[i * 4 + 2] = (p >> 16) & 0xFF;
		out[i * 4 + 3] = 0xFF;
	}
}

void lab_read(struct LabCore* lab, uint32_t address, uint8_t* out, uint32_t length) {
	for (uint32_t i = 0; i < length; ++i) {
		out[i] = lab->core->busRead8(lab->core, address + i);
	}
}

// Writes into ROM or RAM without bus side effects (segment -1 = current bank).
void lab_patch16(struct LabCore* lab, uint32_t address, uint16_t value) {
	lab->core->rawWrite16(lab->core, address, -1, value);
}

size_t lab_savedata_size(struct LabCore* lab) {
	void* sram = NULL;
	size_t size = lab->core->savedataClone(lab->core, &sram);
	free(sram);
	return size;
}

size_t lab_savedata_read(struct LabCore* lab, uint8_t* out, size_t capacity) {
	void* sram = NULL;
	size_t size = lab->core->savedataClone(lab->core, &sram);
	if (size > capacity) {
		size = capacity;
	}
	memcpy(out, sram, size);
	free(sram);
	return size;
}

bool lab_savedata_write(struct LabCore* lab, const uint8_t* data, size_t size) {
	return lab->core->savedataRestore(lab->core, data, size, false);
}

size_t lab_state_size(struct LabCore* lab) {
	return lab->core->stateSize(lab->core);
}

bool lab_state_save(struct LabCore* lab, uint8_t* out) {
	return lab->core->saveState(lab->core, out);
}

bool lab_state_load(struct LabCore* lab, const uint8_t* in) {
	return lab->core->loadState(lab->core, in);
}
