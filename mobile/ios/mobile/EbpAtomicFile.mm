#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface EbpAtomicFile : NSObject <RCTBridgeModule>
@end

@implementation EbpAtomicFile
RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

RCT_REMAP_METHOD(write,
                 writePath:(NSString *)path
                 content:(NSString *)content
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *documents = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
  NSString *target = path.stringByStandardizingPath.stringByResolvingSymlinksInPath;
  if (![target hasPrefix:[documents.stringByResolvingSymlinksInPath stringByAppendingString:@"/"]]) {
    reject(@"atomic_write_failed", @"Storage path must be inside app documents", nil);
    return;
  }
  NSError *error = nil;
  NSData *data = [content dataUsingEncoding:NSUTF8StringEncoding];
  // Foundation writes a sibling temporary file and replaces the destination atomically.
  if (!data || ![data writeToFile:target options:NSDataWritingAtomic error:&error]) {
    reject(@"atomic_write_failed", @"Could not save identity atomically", error);
    return;
  }
  resolve(nil);
}
@end
