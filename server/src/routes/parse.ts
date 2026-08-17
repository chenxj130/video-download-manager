import { Router } from 'express';
import { validateUrl } from '../platforms.js';
import { getEngine } from '../engine/index.js';
import { wrap } from './_helpers.js';

const router: Router = Router();

/** 解析视频 URL，返回元信息（含可用分辨率/格式/大小估算） */
router.post(
  '/',
  wrap(async (req, res) => {
    const { url } = req.body ?? {};
    const { url: normalized } = validateUrl(url);
    const meta = await getEngine().parse(normalized);
    res.json({ metadata: meta });
  })
);

export default router;
