import { Router } from 'express';
import {
  getAllPosts,
  createPost,
  getPostById,
  toggleUpvote,
  resolvePost,
  deletePost,
  getSolvedPosts,
  requestExpertHelp,
  reportPost,
  convertCommunityPostToFAQ,
  setPostDNA,
  setPostTags,
  objectToPromotion,
  confirmSpam,
  hidePost,
  unhidePost,
  lockPost,
  unlockPost,
} from '../controllers/postController.js';
import { checkDuplicateController } from '../controllers/postDuplicateController.js';
import {
  getAnswersList,
  addComment,
  verifyComment,
  setCommentDNA,
  clearCommentDNA,
  acceptCommentAnswer,
} from '../controllers/commentController.js';
import { toggleCommentUpvote, toggleCommentDownvote } from '../controllers/commentVoteController.js';
import { searchCommunityPosts } from '../controllers/communitySearchController.js';
import { getReviewQueue } from '../controllers/freshnessController.js';
import { getBookmarks, toggleBookmark } from '../controllers/bookmarkController.js';
import { getCommunityStats } from '../controllers/communityStatsController.js';
import { getRelatedForPost } from '../controllers/relatedController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = Router();

router.get('/search', protect, searchCommunityPosts);
router.get('/review-queue', protect, authorize('admin', 'moderator'), getReviewQueue);
router.get('/solved', protect, getSolvedPosts);
router.get('/bookmarks', protect, getBookmarks);
router.get('/answers/list', protect, getAnswersList);
router.get('/stats', getCommunityStats);

router.get('/', protect, getAllPosts);
router.post('/check-duplicate', protect, checkDuplicateController);
router.get('/:id', protect, getPostById);
router.get('/:id/related', protect, getRelatedForPost);
router.post('/', protect, createPost);
router.post('/:id/upvote', protect, toggleUpvote);
router.post('/:id/comments', protect, addComment);
router.post('/:id/comments/:commentId/upvote', protect, toggleCommentUpvote);
router.post('/:id/comments/:commentId/downvote', protect, toggleCommentDownvote);
router.patch('/:id/comments/:commentId/verify', protect, authorize('admin', 'moderator'), verifyComment);
router.patch('/:id/comments/:commentId/accept-answer', protect, acceptCommentAnswer);
router.patch('/:id/comments/:commentId/dna', protect, authorize('admin', 'moderator'), setCommentDNA);
router.delete('/:id/comments/:commentId/dna', protect, authorize('admin', 'moderator'), clearCommentDNA);
router.patch('/:id/resolve', protect, resolvePost);
router.post('/:id/request-expert', protect, requestExpertHelp);
router.post('/:id/report', protect, reportPost);
router.post('/:id/bookmark', protect, toggleBookmark);
router.post('/:id/object-to-promotion', protect, authorize('admin', 'moderator'), objectToPromotion);
router.post('/:id/confirm-spam', protect, authorize('admin', 'moderator'), confirmSpam);
router.post('/:id/hide', protect, authorize('admin', 'moderator'), hidePost);
router.post('/:id/unhide', protect, authorize('admin', 'moderator'), unhidePost);
router.post('/:id/lock', protect, authorize('admin', 'moderator'), lockPost);
router.post('/:id/unlock', protect, authorize('admin', 'moderator'), unlockPost);
router.post('/:id/convert-to-faq', protect, authorize('admin'), convertCommunityPostToFAQ);
router.patch('/:id/dna', protect, setPostDNA);
router.patch('/:id/tags', protect, setPostTags);
router.delete('/:id', protect, authorize('admin', 'moderator'), deletePost);

export default router;